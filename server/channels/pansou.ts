import type { Channel, CloudType, NormalizedLink, SearchQuery } from '../types.js';
import { config } from '../config.js';
import {
  cleanHtml,
  firstString,
  normalizeLink,
  parseDate,
  urlKeyFor,
} from './shared.js';

interface PansouLink {
  url?: string;
  password?: string;
  note?: string;
  datetime?: string;
  source?: string;
  work_title?: string;
}

interface PansouResult {
  title?: string;
  content?: string;
  links?: PansouLink[];
  datetime?: string;
  channel?: string;
}

export async function searchPansou(
  query: SearchQuery,
  channel: Channel,
  signal: AbortSignal,
): Promise<NormalizedLink[]> {
  const baseUrl = (channel.baseUrl || config.pansouBaseUrl).replace(/\/$/, '');
  if (!baseUrl) throw new Error('未配置 PanSou 地址');
  const searchPath =
    typeof channel.config.searchPath === 'string' ? channel.config.searchPath : '/api/search';
  const onlyCloudTypes = Array.isArray(channel.config.onlyCloudTypes)
    ? channel.config.onlyCloudTypes.map(String)
    : [];
  const requestedCloud =
    query.cloudType && query.cloudType !== 'all' ? String(query.cloudType) : '';
  // 专用于移动云盘的频道，在搜索夸克时直接跳过，避免无意义的网络请求。
  if (onlyCloudTypes.length && requestedCloud && !onlyCloudTypes.includes(requestedCloud)) {
    return [];
  }
  const payload: Record<string, unknown> = {
    // PanSou 的关键词匹配较严格，带上年份反而经常零结果，标题单独检索更稳。
    kw: query.title,
    res: 'all',
    src: typeof channel.config.src === 'string' ? channel.config.src : 'all',
    refresh: false,
  };
  if (requestedCloud) {
    payload.cloud_types = [requestedCloud];
  } else if (onlyCloudTypes.length) {
    payload.cloud_types = onlyCloudTypes;
  }
  if (Array.isArray(channel.config.channels)) payload.channels = channel.config.channels;
  if (Array.isArray(channel.config.plugins)) payload.plugins = channel.config.plugins;
  if (channel.config.ext && typeof channel.config.ext === 'object') {
    payload.ext = channel.config.ext;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': config.userAgent,
    ...(channel.config.headers && typeof channel.config.headers === 'object'
      ? (channel.config.headers as Record<string, string>)
      : {}),
  };
  const apiKey = channel.config.apiKey;
  if (typeof apiKey === 'string' && apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${baseUrl}${searchPath}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
  });
  if (!response.ok) {
    throw new Error(`PanSou 返回 HTTP ${response.status}`);
  }
  const body = (await response.json()) as {
    code?: number;
    message?: string;
    data?: {
      total?: number;
      results?: PansouResult[];
      merged_by_type?: Record<string, PansouLink[]>;
    };
  };
  if (body.code != null && body.code !== 0 && body.code !== 200) {
    throw new Error(body.message || `PanSou 错误码 ${body.code}`);
  }

  const data = body.data || {};
  const titleByUrl = new Map<string, string>();
  const links: NormalizedLink[] = [];

  for (const result of data.results || []) {
    const title = cleanHtml(firstString(result.title, result.content));
    for (const link of result.links || []) {
      if (!link?.url) continue;
      titleByUrl.set(link.url, title);
    }
  }

  const merged = data.merged_by_type || {};
  for (const [cloudKey, cloudLinks] of Object.entries(merged)) {
    for (const link of cloudLinks || []) {
      if (!link?.url) continue;
      const title =
        firstString(link.work_title, titleByUrl.get(link.url)) ||
        firstString(link.note).split('\n')[0] ||
        query.title;
      const normalized = normalizeLink({
        title,
        url: link.url,
        password: link.password,
        cloudType: cloudKey,
        note: cleanHtml(firstString(link.note)).slice(0, 300),
        datetime: parseDate(link.datetime),
        channelId: channel.id,
        channelName: channel.name,
        raw: link,
      });
      if (normalized) links.push(normalized);
    }
  }

  // 某些版本的 PanSou 或兼容服务只返回 results。
  if (!Object.keys(merged).length) {
    for (const result of data.results || []) {
      const title = cleanHtml(firstString(result.title, result.content));
      for (const link of result.links || []) {
        if (!link?.url) continue;
        const normalized = normalizeLink({
          title: title || query.title,
          url: link.url,
          password: link.password,
          note: cleanHtml(firstString(result.content, link.note)).slice(0, 300),
          datetime: parseDate(link.datetime || result.datetime),
          channelId: channel.id,
          channelName: channel.name,
          raw: link,
        });
        if (normalized) links.push(normalized);
      }
    }
  }

  const seen = new Set<string>();
  return links
    .filter((link) => {
      if (query.cloudType && query.cloudType !== 'all' && link.cloudType !== query.cloudType) {
        return false;
      }
      const key = urlKeyFor(link.url, link.password);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, query.maxResults || 80);
}

export async function testPansou(channel: Channel): Promise<{
  count: number;
  ms: number;
  message?: string;
}> {
  const started = Date.now();
  const controller = new AbortController();
  const onlyCloudTypes = Array.isArray(channel.config.onlyCloudTypes)
    ? channel.config.onlyCloudTypes
    : [];
  const testCloudType = String(
    channel.config.testCloudType || onlyCloudTypes[0] || 'quark',
  ) as CloudType;
  const links = await searchPansou(
    {
      title: testCloudType === 'mobile' ? '电影' : '流浪地球',
      cloudType: testCloudType,
      maxResults: 10,
    },
    channel,
    controller.signal,
  );
  return {
    count: links.length,
    ms: Date.now() - started,
    message: links.length ? '连接正常' : '连接成功，但没有返回结果（可检查插件/频道配置）',
  };
}
