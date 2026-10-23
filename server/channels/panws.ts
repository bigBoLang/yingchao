import { Buffer } from 'node:buffer';
import type { Channel, CloudType, NormalizedLink, SearchQuery } from '../types.js';
import { config } from '../config.js';
import { smartFetch } from '../direct-fetch.js';
import {
  cleanHtml,
  detectCloudType,
  normalizeLink,
  titleMatchScore,
  urlKeyFor,
} from './shared.js';

const DRIVE_TYPE_MAP: Record<string, CloudType> = {
  quark: 'quark',
  baidu: 'baidu',
  aliyun: 'aliyun',
  uc: 'uc',
  xunlei: 'xunlei',
  tianyi: 'tianyi',
  '115': '115',
  '123yun': '123',
  '123': '123',
  guangya: 'guangya',
  yidong: 'mobile',
  mobile: 'mobile',
};

function decodeShareLink(slug: string): string {
  let decoded = '';
  try {
    decoded = Buffer.from(slug, 'base64').toString('utf8').trim();
  } catch {
    return '';
  }
  if (!decoded) return '';
  // 部分卡片是 {u,t} 结构（第三方聚合结果）。
  if (decoded.startsWith('{')) {
    try {
      const parsed = JSON.parse(decoded) as { u?: string; url?: string };
      decoded = String(parsed.u || parsed.url || '');
    } catch {
      return '';
    }
  }
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // 已经是普通 URL 时忽略
  }
  if (!/^https?:|^magnet:|^ed2k:/i.test(decoded)) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      return '';
    }
  }
  return decoded;
}

export async function searchPanws(
  query: SearchQuery,
  channel: Channel,
  signal: AbortSignal,
): Promise<NormalizedLink[]> {
  const baseUrl = (channel.baseUrl || 'https://panws.net').replace(/\/$/, '');
  const cfg = channel.config as { maxResults?: number; timeoutMs?: number };
  const timeoutMs = Math.max(5000, Number(cfg.timeoutMs || 12000));
  const params = new URLSearchParams({ q: query.title });
  const response = await smartFetch(`${baseUrl}/search?${params.toString()}`, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent': config.userAgent,
      Referer: `${baseUrl}/`,
    },
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
  });
  if (!response.ok) throw new Error(`盘万搜返回 HTTP ${response.status}`);
  const html = await response.text();
  const chunks = html.split('<a class="card"').slice(1);
  const links: NormalizedLink[] = [];
  for (const chunk of chunks) {
    const href = chunk.match(/href="\/link\/([^"]+)"/)?.[1];
    if (!href) continue;
    const url = decodeShareLink(href);
    if (!url) continue;
    const rawTitle = chunk.match(/<div class="name">([\s\S]*?)<\/div>/)?.[1] || '';
    const drive = chunk.match(/\/drive\/([^".]+)\.webp/)?.[1] || '';
    const title = cleanHtml(rawTitle) || query.title;
    const detected = detectCloudType(url);
    const cloudType =
      detected !== 'other' ? detected : DRIVE_TYPE_MAP[drive] || 'other';
    const normalized = normalizeLink({
      title,
      url,
      cloudType,
      note: '',
      channelId: channel.id,
      channelName: channel.name,
      raw: {
        drive,
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
    .slice(0, Math.min(60, Number(cfg.maxResults || query.maxResults || 40)));
}

export async function testPanws(channel: Channel): Promise<{
  count: number;
  ms: number;
  message?: string;
}> {
  const started = Date.now();
  const links = await searchPanws(
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
