import type { Channel, CloudType, NormalizedLink, SearchQuery } from '../types.js';
import { config } from '../config.js';
import { smartFetch } from '../direct-fetch.js';
import {
  mapLimit,
  normalizeCloudType,
  normalizeLink,
  titleMatchScore,
  urlKeyFor,
} from './shared.js';

const ZHUYUN_TYPE_MAP: Record<number, CloudType> = {
  0: 'quark',
  1: 'aliyun',
  2: 'baidu',
  3: 'uc',
  4: 'xunlei',
  5: '123',
  6: '115',
  7: 'tianyi',
  8: 'mobile',
  9: 'magnet',
  10: 'guangya',
};

interface ZhuyunItem {
  title?: string;
  url?: string;
  is_type?: number | string;
  sid?: number | string;
  datetime?: string;
  pantype?: string;
  is_local?: boolean;
}

async function getBrowserCookie(baseUrl: string): Promise<string> {
  try {
    const response = await smartFetch(`${baseUrl}/api/other/browser_token`, {
      method: 'POST',
      headers: {
        'User-Agent': config.userAgent,
        Referer: `${baseUrl}/`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return '';
    const body = (await response.json()) as {
      code?: number;
      data?: { token?: string };
    };
    return body.data?.token ? `_bt=${body.data.token}` : '';
  } catch {
    return '';
  }
}

async function decodeLink(
  baseUrl: string,
  cookie: string,
  item: ZhuyunItem,
): Promise<string> {
  const rawUrl = String(item.url || '');
  if (/^https?:|^magnet:|^ed2k:/i.test(rawUrl)) return rawUrl;
  try {
    const response = await smartFetch(`${baseUrl}/api/other/save_url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': config.userAgent,
        Referer: `${baseUrl}/`,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify({
        url: encodeURIComponent(rawUrl),
        title: item.title || '',
        sid: item.sid,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return '';
    const body = (await response.json()) as {
      code?: number;
      data?: { url?: string; need_captcha?: boolean; need_refresh?: boolean };
      message?: string;
    };
    // 实测即使 need_captcha=true，也会先返回真实分享链接；拿不到就跳过。
    return body.data?.url || '';
  } catch {
    return '';
  }
}

async function readSse(
  url: string,
  baseUrl: string,
  cookie: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<ZhuyunItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  const items: ZhuyunItem[] = [];
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    const response = await smartFetch(url, {
      headers: {
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
        'User-Agent': config.userAgent,
        Referer: `${baseUrl}/`,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs + 2000)]),
    });
    if (!response.ok || !response.body) {
      throw new Error(`竹云盘搜返回 HTTP ${response.status}`);
    }
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream')) {
      const text = (await response.text()).slice(0, 500);
      if (/safeline|slg-|<!DOCTYPE html/i.test(text)) {
        throw new Error('公共节点触发了人机校验（SafeLine），请稍后重试，或改用 PanSou / 自建渠道');
      }
      throw new Error(`竹云盘搜返回了非 SSE 响应（${contentType || '未知类型'}）`);
    }

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      // 这个 SSE 节点会在返回结果后继续保持连接，因此给单次 read 加一个安静超时。
      const quietTimeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1600));
      const read = await Promise.race([reader.read(), quietTimeout]);
      if (!read) break;
      const { done, value } = read;
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || '';
      let doneSeen = false;
      for (const event of events) {
        const dataLines = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim());
        for (const data of dataLines) {
          if (!data) continue;
          if (data === '[DONE]' || data.startsWith('[DONE]')) {
            doneSeen = true;
            continue;
          }
          try {
            const item = JSON.parse(data) as ZhuyunItem & { error?: string };
            if (item?.error) continue;
            if (item?.title && item?.url) items.push(item);
          } catch {
            // 非 JSON 的状态行（如“线路：xxx”）忽略
          }
        }
      }
      if (doneSeen) break;
    }
    return items;
  } catch (error) {
    // 超时中止时，已经收到的结果仍然有效。
    if (items.length) return items;
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
    }
  }
}

export async function searchZhuyun(
  query: SearchQuery,
  channel: Channel,
  signal: AbortSignal,
): Promise<NormalizedLink[]> {
  const baseUrl = (channel.baseUrl || config.zhuyunBaseUrl).replace(/\/$/, '');
  if (!baseUrl) throw new Error('未配置竹云盘搜地址');
  const maxDecode = Math.max(
    5,
    Math.min(60, Number(channel.config.maxDecode || 20)),
  );
  const cookie = await getBrowserCookie(baseUrl);

  const params = new URLSearchParams({ title: query.title, from: 'web' });
  if (query.cloudType && query.cloudType !== 'all') {
    const entry = Object.entries(ZHUYUN_TYPE_MAP).find(([, type]) => type === query.cloudType);
    if (entry) params.set('is_type', entry[0]);
  }
  const items = await readSse(
    `${baseUrl}/api/other/web_search?${params.toString()}`,
    baseUrl,
    cookie,
    signal,
    Number(channel.config.timeoutMs || 6500),
  );

  // 先按标题相关度排序，再解码最相关的一批，避免对第三方造成太大压力。
  const ranked = items
    .map((item) => ({ item, score: titleMatchScore(query.title, item.title || '') }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxDecode);

  const decoded = await mapLimit(ranked, 4, async ({ item, score }) => {
    const realUrl = await decodeLink(baseUrl, cookie, item);
    if (!realUrl) return null;
    const cloud = normalizeCloudType(ZHUYUN_TYPE_MAP[Number(item.is_type)]);
    const normalized = normalizeLink({
      title: item.title || query.title,
      url: realUrl,
      cloudType: cloud,
      note: item.pantype || '',
      datetime: item.datetime || '',
      channelId: channel.id,
      channelName: channel.name,
      raw: { ...item, matchScore: score },
    });
    if (!normalized) return null;
    (normalized.raw as Record<string, unknown>).matchScore = score;
    return normalized;
  });

  const seen = new Set<string>();
  return decoded
    .filter((link): link is NormalizedLink => Boolean(link))
    .filter((link) => {
      if (query.cloudType && query.cloudType !== 'all' && link.cloudType !== query.cloudType) {
        return false;
      }
      const key = urlKeyFor(link.url, link.password);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, query.maxResults || 60);
}

export async function testZhuyun(channel: Channel): Promise<{
  count: number;
  ms: number;
  message?: string;
}> {
  const started = Date.now();
  const links = await searchZhuyun(
    { title: '流浪地球', cloudType: 'quark', maxResults: 8 },
    { ...channel, config: { ...channel.config, maxDecode: 6, timeoutMs: 5000 } },
    new AbortController().signal,
  );
  return {
    count: links.length,
    ms: Date.now() - started,
    message: links.length ? '连接正常' : '可访问，但没有解析到结果（公共节点可能限流）',
  };
}
