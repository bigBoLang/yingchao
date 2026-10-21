import crypto from 'node:crypto';
import type { CloudType, NormalizedLink } from '../types.js';

const CLOUD_PATTERNS: Array<[RegExp, CloudType]> = [
  [/(^|\.)pan\.quark\.cn$|(^|\.)quark\.cn$/i, 'quark'],
  [/(^|\.)pan\.baidu\.com$|(^|\.)yun\.baidu\.com$/i, 'baidu'],
  [/(^|\.)aliyundrive\.com$|(^|\.)alipan\.com$/i, 'aliyun'],
  [/(^|\.)drive\.uc\.cn$|(^|\.)fast\.uc\.cn$/i, 'uc'],
  [/(^|\.)pan\.xunlei\.com$/i, 'xunlei'],
  [/(^|\.)115\.com$/i, '115'],
  [/(^|\.)cloud\.189\.cn$/i, 'tianyi'],
  [/(^|\.)123pan\.com$|(^|\.)123684\.com$|(^|\.)123865\.com$/i, '123'],
  [/(^|\.)pan\.pikpak\.com$/i, 'pikpak'],
  [/(^|\.)guangyapan\.com$/i, 'guangya'],
];

export function detectCloudType(rawUrl: string): CloudType {
  const url = (rawUrl || '').trim();
  if (/^magnet:/i.test(url)) return 'magnet';
  if (/^ed2k:/i.test(url)) return 'ed2k';
  try {
    const { hostname } = new URL(url);
    for (const [pattern, type] of CLOUD_PATTERNS) {
      if (pattern.test(hostname)) return type;
    }
  } catch {
    // ignore
  }
  return 'other';
}

export function normalizeCloudType(value: unknown): CloudType {
  const v = String(value || '').toLowerCase();
  const map: Record<string, CloudType> = {
    quark: 'quark',
    '夸克': 'quark',
    '夸克网盘': 'quark',
    baidu: 'baidu',
    '百度': 'baidu',
    '百度网盘': 'baidu',
    aliyun: 'aliyun',
    alipan: 'aliyun',
    '阿里': 'aliyun',
    '阿里云盘': 'aliyun',
    uc: 'uc',
    xunlei: 'xunlei',
    '迅雷': 'xunlei',
    115: '115',
    123: '123',
    tianyi: 'tianyi',
    mobile: 'mobile',
    pikpak: 'pikpak',
    guangya: 'guangya',
    '光鸭': 'guangya',
    magnet: 'magnet',
    '磁力': 'magnet',
    ed2k: 'ed2k',
    other: 'other',
  };
  return map[v] || 'other';
}

export function extractPassword(url: string, provided?: string): string {
  if (provided && provided.trim()) return provided.trim();
  try {
    const parsed = new URL(url);
    return (
      parsed.searchParams.get('pwd') ||
      parsed.searchParams.get('password') ||
      parsed.searchParams.get('passcode') ||
      ''
    ).trim();
  } catch {
    return '';
  }
}

export function canonicalizeUrl(raw: string): string {
  const url = (raw || '').trim();
  if (!url) return '';
  if (/^(magnet|ed2k):/i.test(url)) return url;
  try {
    const parsed = new URL(url);
    // 网盘分享链接统一成短链，去掉跟踪参数；密码单独参与去重。
    const share = parsed.pathname.match(/^\/s\/([A-Za-z0-9_-]+)/);
    if (share) {
      const host = parsed.hostname.replace(/^www\./, '');
      if (/quark\.cn$/i.test(host)) return `https://pan.quark.cn/s/${share[1]}`;
      if (/baidu\.com$/i.test(host)) return `https://pan.baidu.com/s/${share[1]}`;
      if (/aliyundrive\.com$|alipan\.com$/i.test(host)) {
        return `https://www.alipan.com/s/${share[1]}`;
      }
      if (/uc\.cn$/i.test(host)) return `https://drive.uc.cn/s/${share[1]}`;
      if (/xunlei\.com$/i.test(host)) return `${parsed.origin}/s/${share[1]}`;
      if (/115\.com$/i.test(host)) return `${parsed.origin}/s/${share[1]}`;
      return `${parsed.origin}${parsed.pathname}`.replace(/\/$/, '');
    }
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

export function urlKeyFor(url: string, password?: string): string {
  return `${canonicalizeUrl(url)}${password ? `#${password.trim()}` : ''}`;
}

export function normalizeLink(input: {
  title: string;
  url: string;
  password?: string;
  cloudType?: CloudType | string;
  note?: string;
  datetime?: string;
  channelId: string;
  channelName: string;
  raw?: unknown;
}): NormalizedLink | null {
  const url = (input.url || '').trim();
  if (!url) return null;
  const password = extractPassword(url, input.password);
  const cloudType =
    input.cloudType && normalizeCloudType(input.cloudType) !== 'other'
      ? normalizeCloudType(input.cloudType)
      : detectCloudType(url);
  return {
    title: (input.title || input.note || '').trim(),
    url,
    password,
    cloudType,
    note: input.note || '',
    datetime: input.datetime || '',
    channelId: input.channelId,
    channelName: input.channelName,
    raw: input.raw,
  };
}

export function normalizeText(value: string): string {
  return (value || '')
    .toLowerCase()
    .replace(/[\s·・:：\-—_/\\()[\]（）【】,.，。!！?？'"]/g, '')
    .trim();
}

export function titleMatchScore(query: string, title: string): number {
  const q = normalizeText(query);
  const t = normalizeText(title);
  if (!q || !t) return 0;
  if (t.includes(q)) return 1;
  const tokens = (query || '')
    .split(/\s+/)
    .map(normalizeText)
    .filter((token) => token.length > 1);
  if (!tokens.length) return 0;
  let matched = 0;
  let importantMatched = 0;
  for (const token of tokens) {
    if (t.includes(token)) {
      matched++;
      if (token.length >= 3) importantMatched++;
    }
  }
  const base = matched / tokens.length;
  const year = (query.match(/\b(19|20)\d{2}\b/) || [])[0];
  const yearBonus = year && t.includes(year) ? 0.15 : 0;
  return Math.min(1, base * 0.85 + importantMatched * 0.05 + yearBonus);
}

export function hashShort(value: string, length = 12): string {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, length);
}

export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export function parseDate(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function resolveJsonPath(data: unknown, path: string): unknown {
  if (!path) return data;
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
    .reduce<unknown>((current, key) => {
      if (current == null) return undefined;
      if (Array.isArray(current)) {
        const index = Number(key);
        return Number.isInteger(index) ? current[index] : undefined;
      }
      if (typeof current === 'object') {
        return (current as Record<string, unknown>)[key];
      }
      return undefined;
    }, data);
}

export function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (value == null) continue;
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
}

export function cleanHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}
