import type { Channel, NormalizedLink, SearchQuery } from '../types.js';
import { config } from '../config.js';
import { smartFetch } from '../direct-fetch.js';
import {
  firstString,
  normalizeCloudType,
  normalizeLink,
  titleMatchScore,
  urlKeyFor,
} from './shared.js';

interface YunsoItem {
  ScrName?: string;
  Scrurl?: string;
  Scrpass?: string;
  addtime?: number | string;
  Scrurlname?: string;
}

function formatTime(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return firstString(value);
  const date = new Date(n);
  return Number.isNaN(date.getTime()) ? String(n) : date.toISOString();
}

export async function searchYunso(
  query: SearchQuery,
  channel: Channel,
  signal: AbortSignal,
): Promise<NormalizedLink[]> {
  const baseUrl = (channel.baseUrl || 'https://www.yunso.net').replace(/\/$/, '');
  const cfg = channel.config as { maxResults?: number; timeoutMs?: number };
  const timeoutMs = Math.max(5000, Number(cfg.timeoutMs || 12000));
  const params = new URLSearchParams({
    wd: query.title,
    mode: '90002',
    page: '1',
    original: '1',
  });
  const response = await smartFetch(`${baseUrl}/api/opensearch.php?${params.toString()}`, {
    headers: {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': config.userAgent,
      Referer: `${baseUrl}/`,
    },
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
  });
  if (!response.ok) throw new Error(`小云搜索返回 HTTP ${response.status}`);
  const body = (await response.json()) as {
    code?: number;
    msg?: string;
    Data?: YunsoItem[];
  };
  if (body.code != null && body.code !== 0 && body.code !== 200) {
    throw new Error(body.msg || `小云搜索错误码 ${body.code}`);
  }
  const items = Array.isArray(body.Data) ? body.Data : [];
  const links: NormalizedLink[] = [];
  for (const item of items) {
    const url = firstString(item.Scrurl);
    if (!url) continue;
    const title = firstString(item.ScrName) || query.title;
    const normalized = normalizeLink({
      title,
      url,
      password: firstString(item.Scrpass),
      cloudType: normalizeCloudType(item.Scrurlname),
      note: firstString(item.Scrurlname),
      datetime: formatTime(item.addtime),
      channelId: channel.id,
      channelName: channel.name,
      raw: {
        ...item,
        matchScore: titleMatchScore(query.title, title),
      },
    });
    if (normalized) links.push(normalized);
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
    .slice(0, Math.min(100, Number(cfg.maxResults || query.maxResults || 60)));
}

export async function testYunso(channel: Channel): Promise<{
  count: number;
  ms: number;
  message?: string;
}> {
  const started = Date.now();
  const links = await searchYunso(
    { title: '流浪地球', cloudType: 'quark', maxResults: 10 },
    channel,
    new AbortController().signal,
  );
  return {
    count: links.length,
    ms: Date.now() - started,
    message: links.length ? '连接正常' : '连接成功，但没有返回结果',
  };
}
