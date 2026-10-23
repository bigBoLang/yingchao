import type { Channel, NormalizedLink, SearchQuery } from '../types.js';
import { config } from '../config.js';
import { smartFetch } from '../direct-fetch.js';
import { assertPublicUrl } from '../net-guard.js';
import {
  firstString,
  normalizeLink,
  resolveJsonPath,
  urlKeyFor,
} from './shared.js';

type JsonRecord = Record<string, unknown>;

function templateValue(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === 'string') {
    return value.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '');
  }
  if (Array.isArray(value)) return value.map((item) => templateValue(item, vars));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as JsonRecord).map(([key, item]) => [key, templateValue(item, vars)]),
    );
  }
  return value;
}

export async function searchHttp(
  query: SearchQuery,
  channel: Channel,
  signal: AbortSignal,
): Promise<NormalizedLink[]> {
  const cfg = channel.config as {
    search?: {
      url?: string;
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
      contentType?: string;
    };
    itemsPath?: string;
    fields?: {
      title?: string;
      url?: string;
      password?: string;
      cloudType?: string;
      note?: string;
      datetime?: string;
    };
    cloudTypeMap?: Record<string, string>;
    maxResults?: number;
  };

  const endpointTemplate = cfg.search?.url;
  if (!endpointTemplate) throw new Error('自定义渠道缺少 search.url 配置');
  const baseUrl = (channel.baseUrl || '').replace(/\/$/, '');
  const vars = {
    query: query.title,
    queryEncoded: encodeURIComponent(query.title),
    year: query.year || '',
    type: query.type || '',
    cloudType: query.cloudType && query.cloudType !== 'all' ? query.cloudType : '',
  };
  let endpoint = templateValue(endpointTemplate, vars) as string;
  if (baseUrl && !/^https?:/i.test(endpoint)) {
    endpoint = `${baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
  }
  const method = (cfg.search?.method || 'GET').toUpperCase();
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    'User-Agent': config.userAgent,
    ...(cfg.search?.headers || {}),
  };
  let body: string | undefined;
  if (method !== 'GET' && cfg.search?.body != null) {
    const templated = templateValue(cfg.search.body, vars);
    if (typeof templated === 'string') {
      body = templated;
    } else {
      body = JSON.stringify(templated);
      headers['Content-Type'] = cfg.search?.contentType || 'application/json';
    }
  }

  // 自定义渠道的地址由用户填写，默认不允许指向内网，避免服务端被当作内网探测跳板。
  if (!config.allowPrivateHosts) await assertPublicUrl(endpoint);

  const response = await smartFetch(endpoint, {
    method,
    headers,
    body,
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  });
  if (!response.ok) throw new Error(`自定义渠道返回 HTTP ${response.status}`);
  const data = (await response.json()) as unknown;
  const itemsRaw = cfg.itemsPath ? resolveJsonPath(data, cfg.itemsPath) : data;
  const items = Array.isArray(itemsRaw)
    ? itemsRaw
    : itemsRaw && typeof itemsRaw === 'object'
      ? [itemsRaw]
      : [];
  const fields = cfg.fields || {};
  const links: NormalizedLink[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      const normalized = normalizeLink({
        title: query.title,
        url: item,
        channelId: channel.id,
        channelName: channel.name,
        raw: item,
      });
      if (normalized) links.push(normalized);
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const record = item as JsonRecord;
    const get = (key?: string) =>
      key ? resolveJsonPath(record, key) : undefined;
    const url = firstString(get(fields.url || 'url'), get('link'), get('share_url'));
    if (!url) continue;
    const rawCloud = firstString(get(fields.cloudType || 'cloud_type'), get('type'));
    const mappedCloud = cfg.cloudTypeMap?.[rawCloud] || rawCloud;
    const normalized = normalizeLink({
      title:
        firstString(get(fields.title || 'title'), get('name'), get('work_title')) || query.title,
      url,
      password: firstString(get(fields.password || 'password'), get('pwd')),
      cloudType: mappedCloud,
      note: firstString(get(fields.note || 'note'), get('description'), get('content')),
      datetime: firstString(get(fields.datetime || 'datetime'), get('time'), get('created_at')),
      channelId: channel.id,
      channelName: channel.name,
      raw: item,
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
    .slice(0, Math.min(100, cfg.maxResults || query.maxResults || 60));
}

export async function testHttp(channel: Channel): Promise<{
  count: number;
  ms: number;
  message?: string;
}> {
  const started = Date.now();
  const links = await searchHttp(
    { title: '流浪地球', cloudType: 'quark', maxResults: 10 },
    channel,
    new AbortController().signal,
  );
  return { count: links.length, ms: Date.now() - started };
}
