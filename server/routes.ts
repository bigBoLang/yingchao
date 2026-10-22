import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';
import {
  createChannel,
  db,
  deleteChannel,
  getChannel,
  getResource,
  getResourceStatsForSubjects,
  getRuntimeSettings,
  getSetting,
  getStats,
  listChannels,
  listCollections,
  listJobs,
  listSubjects,
  now,
  recoverStaleJobs,
  setSetting,
  updateChannel,
  upsertSubject,
  seedDefaults,
} from './db.js';
import type { Channel, CloudType, MediaType, Subject } from './types.js';
import {
  COLLECTIONS,
  ensureSubjectDetail,
  getHomeSections,
  searchSubjects,
} from './douban.js';
import { CHANNEL_PRESETS, testChannel } from './channels/index.js';
import {
  getSubjectBundle,
  searchSubjectResources,
} from './services/search.js';
import { validateResource } from './validator.js';
import {
  formatBytes,
  getQuarkCookie,
  parseQuarkShare,
  resolveQuarkFileDownload,
  resolveQuarkShare,
  signPlayUrl,
  signShortPlayUrl,
  verifyPlayToken,
} from './quark.js';
import {
  parseMobileShare,
  resolveMobileFilePlay,
  resolveMobileShare,
} from './mobile.js';
import { openQuarkRangeStream } from './quark-stream.js';
import { runJob } from './scheduler.js';

const PLAYER_DEFAULTS = {
  iina: true,
  vlc: true,
  potplayer: false,
  mpv: true,
  defaultExternal: 'iina',
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function maskCookie(cookie: string): string {
  if (!cookie) return '';
  if (cookie.length <= 20) return '••••••';
  return `${cookie.slice(0, 10)}…${cookie.slice(-6)}`;
}

function sanitizeChannel(channel: Channel): Channel & { hasApiKey?: boolean } {
  const configCopy = JSON.parse(JSON.stringify(channel.config || {})) as Record<string, unknown>;
  const hasApiKey = Boolean(configCopy.apiKey);
  if (configCopy.apiKey) configCopy.apiKey = '••••••';
  if (configCopy.headers && typeof configCopy.headers === 'object') {
    const headers = configCopy.headers as Record<string, string>;
    for (const key of Object.keys(headers)) {
      if (/authorization|cookie|token/i.test(key)) headers[key] = '••••••';
    }
  }
  return { ...channel, config: configCopy, hasApiKey };
}

function withResourceCounts(subjects: Subject[]): Subject[] {
  const counts = getResourceStatsForSubjects(subjects.map((subject) => subject.id));
  return subjects.map((subject) => ({
    ...subject,
    resourceCount: counts[subject.id] || 0,
  }));
}

async function ensureLocalSubjects(): Promise<void> {
  const stats = getStats();
  if (stats.subjects > 0) return;
  await getHomeSections();
}

function sanitizeType(value: unknown): MediaType | '' {
  return value === 'movie' || value === 'tv' ? value : '';
}

function isHlsUrl(url: string): boolean {
  try {
    return /\.m3u8$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function proxifyHlsUri(uri: string, baseUrl: string, referer: string): string {
  const value = uri.trim();
  if (!value || /^(data|blob|skd|file):/i.test(value)) return uri;
  let absolute: URL;
  try {
    absolute = new URL(value, baseUrl);
  } catch {
    return uri;
  }
  if (!/^https?:$/i.test(absolute.protocol)) return uri;
  return signShortPlayUrl(absolute.toString(), referer);
}

function rewriteHlsPlaylist(playlist: string, playlistUrl: string, referer: string): string {
  return playlist
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim()) return line;
      if (line.startsWith('#')) {
        // EXT-X-KEY / EXT-X-MAP / EXT-X-MEDIA 等标签里的 URI 也要走本机代理。
        return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
          return `URI="${proxifyHlsUri(uri, playlistUrl, referer)}"`;
        });
      }
      return proxifyHlsUri(line, playlistUrl, referer);
    })
    .join('\n');
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => ({
    ok: true,
    name: '影巢',
    version: '0.1.0',
    time: now(),
  }));

  app.get('/api/home', async (_request, reply) => {
    try {
      const sections = await getHomeSections();
      const counts = getResourceStatsForSubjects(
        [...new Set(sections.flatMap((section) => section.items.map((item) => item.id)))],
      );
      const sectionsWithCounts = sections.map((section) => ({
        ...section,
        items: section.items.slice(0, 16).map((item) => ({
          ...item,
          resourceCount: counts[item.id] || 0,
        })),
      }));
      const hero =
        sectionsWithCounts.find((section) => section.key === 'movie_showing')?.items[0] ||
        sectionsWithCounts[0]?.items[0] ||
        null;
      return {
        hero: hero ? { ...hero, resourceCount: counts[hero.id] || 0 } : null,
        sections: sectionsWithCounts,
        stats: getStats(),
      };
    } catch (error) {
      reply.code(502);
      return { error: `豆瓣数据获取失败：${errorMessage(error)}` };
    }
  });

  app.get('/api/subjects', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    try {
      await ensureLocalSubjects();
      const result = listSubjects({
        type: sanitizeType(query.type),
        genre: query.genre || '',
        sort: (query.sort as 'rating' | 'heat' | 'new' | 'views') || 'heat',
        page: Number(query.page || 1),
        pageSize: Number(query.pageSize || 24),
      });
      return { ...result, items: withResourceCounts(result.items) };
    } catch (error) {
      reply.code(502);
      return { error: errorMessage(error) };
    }
  });

  app.get('/api/subjects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, string | undefined>;
    try {
      let subject = await ensureSubjectDetail(id, sanitizeType(query.type));
      if (!subject) {
        reply.code(404);
        return { error: '没有找到这个条目' };
      }
      db.prepare(
        'UPDATE subjects SET views = views + 1, heat = heat + 1, updated_at = ? WHERE id = ?',
      ).run(now(), subject.id);
      const bundle = await getSubjectBundle(subject.id);
      subject = bundle.subject || subject;
      return {
        ...bundle,
        subject: {
          ...subject,
          resourceCount: bundle.resources.length,
        },
        channels: listChannels().map((channel) => ({
          id: channel.id,
          name: channel.name,
          type: channel.type,
          enabled: channel.enabled,
          lastOkAt: channel.lastOkAt,
          lastError: channel.lastError,
        })),
        shouldSearch:
          bundle.resources.length === 0 ||
          now() - bundle.searchState.lastSearchedAt >
            getRuntimeSettings().searchCacheHours * 3600,
      };
    } catch (error) {
      reply.code(502);
      return { error: `条目详情获取失败：${errorMessage(error)}` };
    }
  });

  app.post('/api/subjects/:id/search', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as {
      force?: boolean;
      cloudType?: CloudType | 'all';
      type?: MediaType | '';
    };
    try {
      const subject = await ensureSubjectDetail(id, body.type);
      if (!subject) {
        reply.code(404);
        return { error: '没有找到这个条目' };
      }
      return await searchSubjectResources(subject, {
        force: body.force !== false,
        cloudType: body.cloudType || 'quark',
      });
    } catch (error) {
      reply.code(502);
      return { error: `网盘检索失败：${errorMessage(error)}` };
    }
  });

  app.get('/api/search', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const q = (query.q || '').trim();
    if (!q) return { query: '', items: [] };
    try {
      const items = await searchSubjects(q, Number(query.limit || 12));
      const enriched = withResourceCounts(items);
      return { query: q, items: enriched };
    } catch (error) {
      // 豆瓣不可用时退回本地缓存搜索
      const rows = db
        .prepare(
          "SELECT * FROM subjects WHERE title LIKE ? OR original_title LIKE ? ORDER BY rating_count DESC LIMIT 12",
        )
        .all(`%${q}%`, `%${q}%`) as Array<Record<string, unknown>>;
      if (rows.length) {
        const items = rows.map((row) => ({
          id: String(row.id),
          type: String(row.type),
          title: String(row.title),
          year: String(row.year || ''),
          poster: String(row.poster || ''),
          rating: Number(row.rating || 0),
          ratingCount: Number(row.rating_count || 0),
          genres: JSON.parse(String(row.genres || '[]')),
          intro: String(row.intro || ''),
        })) as unknown as Subject[];
        return { query: q, items: withResourceCounts(items), warning: '豆瓣接口暂时不可用，展示本地缓存' };
      }
      reply.code(502);
      return { error: `搜索失败：${errorMessage(error)}` };
    }
  });

  app.get('/api/channels', async () => ({
    items: listChannels().map(sanitizeChannel),
    presets: CHANNEL_PRESETS,
  }));

  app.post('/api/channels', async (request, reply) => {
    const body = (request.body || {}) as {
      name?: string;
      type?: string;
      baseUrl?: string;
      enabled?: boolean;
      priority?: number;
      config?: Record<string, unknown>;
    };
    if (!body.name?.trim()) {
      reply.code(400);
      return { error: '请填写渠道名称' };
    }
    if (!['pansou', 'zhuyun', 'http'].includes(body.type || '')) {
      reply.code(400);
      return { error: '渠道类型必须是 pansou、zhuyun 或 http' };
    }
    const channel = createChannel({
      name: body.name.trim(),
      type: body.type as Channel['type'],
      baseUrl: body.baseUrl?.trim(),
      enabled: body.enabled !== false,
      priority: Number(body.priority || 100),
      config: body.config || {},
    });
    return { channel: sanitizeChannel(channel) };
  });

  app.put('/api/channels/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as {
      name?: string;
      type?: string;
      baseUrl?: string;
      enabled?: boolean;
      priority?: number;
      config?: Record<string, unknown>;
    };
    const current = getChannel(id);
    if (!current) {
      reply.code(404);
      return { error: '渠道不存在' };
    }
    if (body.type != null && !['pansou', 'zhuyun', 'http'].includes(body.type)) {
      reply.code(400);
      return { error: '渠道类型必须是 pansou、zhuyun 或 http' };
    }
    let configPatch = body.config;
    if (configPatch) {
      const merged = { ...current.config, ...configPatch };
      if (merged.apiKey === '••••••') merged.apiKey = current.config.apiKey;
      if (configPatch.headers && typeof configPatch.headers === 'object') {
        const currentHeaders = (current.config.headers || {}) as Record<string, string>;
        const nextHeaders = configPatch.headers as Record<string, string>;
        for (const key of Object.keys(nextHeaders)) {
          if (nextHeaders[key] === '••••••') nextHeaders[key] = currentHeaders[key] || '';
        }
        merged.headers = nextHeaders;
      }
      configPatch = merged;
    }
    const updated = updateChannel(id, {
      name: body.name,
      type: body.type as Channel['type'] | undefined,
      baseUrl: body.baseUrl,
      enabled: body.enabled,
      priority: body.priority,
      config: configPatch,
    });
    return { channel: updated ? sanitizeChannel(updated) : null };
  });

  app.delete('/api/channels/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!deleteChannel(id)) {
      reply.code(404);
      return { error: '渠道不存在' };
    }
    return { ok: true };
  });

  app.post('/api/channels/:id/test', async (request, reply) => {
    const { id } = request.params as { id: string };
    const channel = getChannel(id);
    if (!channel) {
      reply.code(404);
      return { error: '渠道不存在' };
    }
    return testChannel(channel);
  });

  app.get('/api/settings', async () => {
    const cookie = getQuarkCookie();
    return {
      quarkCookieSet: Boolean(cookie),
      quarkCookiePreview: maskCookie(cookie),
      player: getSetting('player_prefs', PLAYER_DEFAULTS),
      runtime: getRuntimeSettings(),
      config: {
        port: config.port,
        dataDir: config.dataDir,
        pansouBaseUrl: config.pansouBaseUrl,
        zhuyunBaseUrl: config.zhuyunBaseUrl,
      },
    };
  });

  app.put('/api/settings', async (request, reply) => {
    const body = (request.body || {}) as {
      quarkCookie?: string;
      player?: Record<string, unknown>;
      runtime?: Record<string, unknown>;
    };
    if (typeof body.quarkCookie === 'string') {
      setSetting('quark_cookie', body.quarkCookie.trim());
    }
    if (body.player && typeof body.player === 'object') {
      setSetting('player_prefs', { ...PLAYER_DEFAULTS, ...body.player });
    }
    if (body.runtime && typeof body.runtime === 'object') {
      const current = getRuntimeSettings();
      const next = { ...current };
      for (const key of [
        'searchCacheHours',
        'validateHours',
        'hotRefreshHours',
        'hotRefreshLimit',
      ] as const) {
        const value = Number((body.runtime as Record<string, unknown>)[key]);
        if (Number.isFinite(value) && value >= 0) next[key] = value;
      }
      if (typeof body.runtime.schedulerEnabled === 'boolean') {
        next.schedulerEnabled = body.runtime.schedulerEnabled;
      }
      setSetting('runtime_settings', next);
    }
    const cookie = getQuarkCookie();
    return {
      ok: true,
      quarkCookieSet: Boolean(cookie),
      quarkCookiePreview: maskCookie(cookie),
      player: getSetting('player_prefs', PLAYER_DEFAULTS),
      runtime: getRuntimeSettings(),
    };
  });

  app.get('/api/admin/overview', async () => {
    const jobs = listJobs(20);
    return {
      stats: getStats(),
      jobs,
      collections: listCollections(),
      collectionDefs: COLLECTIONS,
      channels: listChannels().map(sanitizeChannel),
      runtime: getRuntimeSettings(),
      quarkCookieSet: Boolean(getQuarkCookie()),
      serverTime: now(),
    };
  });

  app.post('/api/admin/run', async (request, reply) => {
    const body = (request.body || {}) as { job?: string };
    if (!body.job) {
      reply.code(400);
      return { error: '缺少 job 参数' };
    }
    try {
      return { ok: true, result: await runJob(body.job) };
    } catch (error) {
      reply.code(400);
      return { error: errorMessage(error) };
    }
  });

  app.post('/api/resources/:id/check', async (request, reply) => {
    const { id } = request.params as { id: string };
    const resource = getResource(id);
    if (!resource) {
      reply.code(404);
      return { error: '资源不存在' };
    }
    const checked = await validateResource(resource);
    return { resource: checked };
  });

  app.post('/api/resources/:id/resolve', async (request, reply) => {
    const { id } = request.params as { id: string };
    const resource = getResource(id);
    if (!resource) {
      reply.code(404);
      return { error: '资源不存在' };
    }
    try {
      if (parseQuarkShare(resource.url, resource.password)) {
        const result = await resolveQuarkShare(resource.url, resource.password);
        return {
          ...result,
          files: result.files.map((file) => ({
            ...file,
            sizeLabel: formatBytes(file.size),
          })),
        };
      }
      if (parseMobileShare(resource.url, resource.password)) {
        const result = await resolveMobileShare(resource.url, resource.password);
        return {
          ...result,
          files: result.files.map((file) => ({
            ...file,
            sizeLabel: formatBytes(file.size),
          })),
        };
      }
      if (
        /^https?:\/\//i.test(resource.url) &&
        /\.(mp4|mkv|mov|m4v|webm|ts|flv|avi|m3u8)(\?|$)/i.test(resource.url)
      ) {
        return {
          shareId: '',
          files: [
            {
              fid: '',
              name: resource.title || '视频直链',
              size: 0,
              isDir: false,
              path: resource.title || '视频直链',
              directUrl: resource.url,
              proxyUrl: signPlayUrl(resource.url, ''),
              sizeLabel: '',
            },
          ],
          message: '',
        };
      }
      reply.code(400);
      return {
        error:
          '该资源不是可直接解析的夸克/移动云盘分享或视频直链。可以先复制链接到对应网盘 App 打开。',
      };
    } catch (error) {
      reply.code(400);
      return { error: errorMessage(error) };
    }
  });

  app.post('/api/resources/:id/play', async (request, reply) => {
    const { id } = request.params as { id: string };
    const resource = getResource(id);
    if (!resource) {
      reply.code(404);
      return { error: '资源不存在' };
    }
    const body = (request.body || {}) as {
      fid?: string;
      name?: string;
      size?: number;
    };
    if (!body.fid) {
      reply.code(400);
      return { error: '缺少文件 ID' };
    }
    try {
      if (parseMobileShare(resource.url, resource.password)) {
        return await resolveMobileFilePlay({
          shareUrl: resource.url,
          password: resource.password,
          fid: body.fid,
        });
      }
      if (!parseQuarkShare(resource.url, resource.password)) {
        reply.code(400);
        return { error: '该资源不是夸克或移动云盘分享' };
      }
      return await resolveQuarkFileDownload({
        shareUrl: resource.url,
        password: resource.password,
        fid: body.fid,
        name: body.name,
        size: Number(body.size || 0),
      });
    } catch (error) {
      reply.code(400);
      return { error: errorMessage(error) };
    }
  });

  app.get('/api/config', async () => ({
    name: '影巢',
    version: '0.1.0',
    hasQuarkCookie: Boolean(getQuarkCookie()),
    enabledChannels: listChannels(true).length,
    player: getSetting('player_prefs', PLAYER_DEFAULTS),
  }));

  // 图片代理：豆瓣图片有防盗链，统一从服务端转发。
  app.get('/api/image', async (request, reply) => {
    const query = request.query as { url?: string };
    let target = query.url || '';
    if (!target) {
      reply.code(400);
      return { error: '缺少 url' };
    }
    if (target.startsWith('http://')) target = `https://${target.slice(7)}`;
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      reply.code(400);
      return { error: '图片地址无效' };
    }
    if (!/(^|\.)doubanio\.com$/i.test(parsed.hostname) && !/(^|\.)douban\.com$/i.test(parsed.hostname)) {
      reply.code(403);
      return { error: '只允许代理豆瓣图片' };
    }
    try {
      const upstream = await fetch(target, {
        headers: {
          'User-Agent': config.userAgent,
          Referer: 'https://movie.douban.com/',
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(12000),
      });
      if (!upstream.ok || !upstream.body) {
        reply.code(upstream.status || 502);
        return { error: '图片加载失败' };
      }
      reply.header('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
      reply.header('Cache-Control', 'public, max-age=604800, immutable');
      return reply.send(Readable.fromWeb(upstream.body as never));
    } catch (error) {
      reply.code(502);
      return { error: errorMessage(error) };
    }
  });

  // 视频流转发：支持 Range，可给浏览器 <video> 或外部播放器使用。
  app.route({
    method: ['GET', 'HEAD'],
    url: '/api/play/:token',
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { token } = request.params as { token: string };
      const target = verifyPlayToken(token);
      reply.header('Access-Control-Allow-Origin', '*');
      if (!target) {
        reply.code(403);
        return '播放链接无效或已过期';
      }
      let host = '';
      try {
        host = new URL(target.url).hostname;
      } catch {
        reply.code(400);
        return '播放地址无效';
      }
      const isQuark = /(^|\.)quark\.cn$/i.test(host);
      const headers: Record<string, string> = {
        'User-Agent': config.userAgent,
        Accept: '*/*',
        Referer: target.referer || (isQuark ? 'https://pan.quark.cn/' : ''),
      };
      if (isQuark) {
        const cookie = getQuarkCookie();
        if (cookie) headers.Cookie = cookie;
      }
      const range = request.headers.range;
      if (range) headers.Range = range;

      // 夸克直链单连接带宽有限。对非 HLS 的视频流拆成多段并发拉取，
      // 让有会员的账号真正跑满多连接带宽；失败时自动回退到单流。
      if (isQuark && request.method !== 'HEAD' && !isHlsUrl(target.url)) {
        const abortParallel = new AbortController();
        reply.raw.on('close', () => abortParallel.abort());
        const parallel = await openQuarkRangeStream({
          url: target.url,
          headers,
          range,
          signal: abortParallel.signal,
        });
        if (parallel) {
          reply.code(parallel.status);
          for (const [key, value] of Object.entries(parallel.headers)) {
            reply.header(key, value);
          }
          reply.raw.on('close', parallel.cancel);
          return reply.send(parallel.stream);
        }
      }

      try {
        const upstream = await fetch(target.url, {
          method: request.method === 'HEAD' ? 'HEAD' : 'GET',
          headers,
          redirect: 'follow',
          signal: AbortSignal.timeout(6 * 60 * 60 * 1000),
        });
        reply.code(upstream.status);

        const contentType = upstream.headers.get('content-type') || '';
        const mightBePlaylist =
          request.method !== 'HEAD' &&
          (isHlsUrl(target.url) || /mpegurl/i.test(contentType));

        if (mightBePlaylist) {
          const text = await upstream.text();
          if (text.trimStart().startsWith('#EXTM3U')) {
            // HLS 分片、密钥和子播放列表都换成短期本机代理地址，浏览器只和影巢通信。
            return reply
              .header('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8')
              .header('Cache-Control', 'no-store')
              .send(rewriteHlsPlaylist(text, target.url, target.referer));
          }
          return reply
            .header('Content-Type', contentType || 'text/plain; charset=utf-8')
            .header('Cache-Control', 'no-store')
            .send(text);
        }

        reply.header('Accept-Ranges', 'bytes');
        for (const key of [
          'content-type',
          'content-length',
          'content-range',
          'accept-ranges',
          'etag',
          'last-modified',
        ]) {
          const value = upstream.headers.get(key);
          if (value) reply.header(key, value);
        }
        reply.header('Cache-Control', 'no-store');
        if (request.method === 'HEAD' || !upstream.body) {
          return reply.send();
        }
        request.raw.on('close', () => {
          upstream.body?.cancel().catch(() => {});
        });
        return reply.send(Readable.fromWeb(upstream.body as never));
      } catch (error) {
        reply.code(502);
        return `上游拉流失败：${errorMessage(error)}`;
      }
    },
  });

  app.options('/api/play/:token', async (_request, reply) => {
    reply
      .header('Access-Control-Allow-Origin', '*')
      .header('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS')
      .header('Access-Control-Allow-Headers', 'Range,Content-Type');
    return reply.send();
  });

  app.get('/api/collections', async () => ({
    items: listCollections(),
    defs: COLLECTIONS,
  }));
}

export async function registerStatic(app: FastifyInstance): Promise<void> {
  const dist = path.join(config.root, 'dist');
  if (!fs.existsSync(dist)) return;
  const fastifyStatic = (await import('@fastify/static')).default;
  // 只让构建产物走静态通配路由，避免 /* 抢占 /api/play/:token 这类参数路由；
  // 根路径仍由下面的 SPA fallback 返回 index.html。
  await app.register(fastifyStatic, {
    root: path.join(dist, 'assets'),
    prefix: '/assets/',
  });
  for (const file of ['favicon.svg', 'favicon.ico', 'robots.txt']) {
    if (fs.existsSync(path.join(dist, file))) {
      app.get(`/${file}`, (_request, reply) => reply.sendFile(file, dist));
    }
  }
  app.setNotFoundHandler((request, reply) => {
    const url = request.raw.url || '';
    if (url.startsWith('/api/') || url.startsWith('/assets/')) {
      reply.code(404).send({ error: 'Not found' });
      return;
    }
    return reply.sendFile('index.html', dist);
  });
}

export function bootstrapSettings(): void {
  recoverStaleJobs();
  seedDefaults();
  if (getSetting('player_prefs') == null) setSetting('player_prefs', PLAYER_DEFAULTS);
}

export { upsertSubject };
