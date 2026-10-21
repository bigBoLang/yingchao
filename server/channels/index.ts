import type {
  Channel,
  ChannelSearchResult,
  NormalizedLink,
  SearchQuery,
} from '../types.js';
import { channelHealth } from '../db.js';
import { searchPansou, testPansou } from './pansou.js';
import { searchZhuyun, testZhuyun } from './zhuyun.js';
import { searchHttp, testHttp } from './http.js';
import { titleMatchScore, urlKeyFor } from './shared.js';

async function dispatch(
  query: SearchQuery,
  channel: Channel,
  signal: AbortSignal,
): Promise<NormalizedLink[]> {
  switch (channel.type) {
    case 'pansou':
      return searchPansou(query, channel, signal);
    case 'zhuyun':
      return searchZhuyun(query, channel, signal);
    case 'http':
      return searchHttp(query, channel, signal);
    default:
      throw new Error(`不支持的渠道类型：${channel.type}`);
  }
}

export async function searchOneChannel(
  query: SearchQuery,
  channel: Channel,
): Promise<ChannelSearchResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timeoutMs = Math.max(5000, Number(channel.config.timeoutMs || 24000));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const links = await dispatch(query, channel, controller.signal);
    channelHealth(channel.id, true);
    return {
      channel,
      links,
      ms: Date.now() - started,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === 'AbortError' || error.name === 'TimeoutError'
          ? `请求超时（${Math.round(timeoutMs / 1000)}s）`
          : error.message
        : String(error);
    channelHealth(channel.id, false, message);
    return {
      channel,
      links: [],
      error: message,
      ms: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runChannelSearches(
  query: SearchQuery,
  channels: Channel[],
): Promise<ChannelSearchResult[]> {
  const enabled = channels.filter((channel) => channel.enabled);
  return Promise.all(enabled.map((channel) => searchOneChannel(query, channel)));
}

export function dedupeLinks(
  results: ChannelSearchResult[],
  query: string,
): Array<{ link: NormalizedLink; score: number }> {
  const map = new Map<string, { link: NormalizedLink; score: number }>();
  for (const result of results) {
    for (const link of result.links) {
      const key = urlKeyFor(link.url, link.password);
      const rawScore = (link.raw as { matchScore?: number } | undefined)?.matchScore;
      const score =
        typeof rawScore === 'number' && rawScore > 0
          ? rawScore
          : titleMatchScore(query, link.title);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { link, score });
        continue;
      }
      // 同一链接保留信息更完整的一份
      const quality = (l: NormalizedLink) =>
        (l.title ? 2 : 0) + (l.password ? 1 : 0) + (l.note ? 1 : 0);
      if (quality(link) > quality(existing.link)) {
        map.set(key, { link, score: Math.max(score, existing.score) });
      } else {
        existing.score = Math.max(existing.score, score);
      }
    }
  }
  return [...map.values()];
}

export async function testChannel(channel: Channel): Promise<{
  ok: boolean;
  count: number;
  ms: number;
  message: string;
}> {
  const started = Date.now();
  try {
    let result: { count: number; ms: number; message?: string };
    if (channel.type === 'pansou') result = await testPansou(channel);
    else if (channel.type === 'zhuyun') result = await testZhuyun(channel);
    else if (channel.type === 'http') result = await testHttp(channel);
    else throw new Error(`不支持的渠道类型：${channel.type}`);
    channelHealth(channel.id, true);
    return {
      ok: true,
      count: result.count,
      ms: Date.now() - started,
      message: result.message || `返回 ${result.count} 条结果`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    channelHealth(channel.id, false, message);
    return { ok: false, count: 0, ms: Date.now() - started, message };
  }
}

export const CHANNEL_PRESETS = [
  {
    type: 'pansou',
    name: 'PanSou（默认）',
    baseUrl: 'http://localhost:8888',
    description: '开源自建聚合搜索，支持 Telegram 频道和插件。默认地址为本机 8888 端口。',
    config: {},
  },
  {
    type: 'zhuyun',
    name: '竹云盘搜',
    baseUrl: 'https://pan.zhuyunso.top',
    description: '公共网盘搜索引擎，支持夸克、百度、迅雷等。无需配置即可使用，公共节点可能限流。',
    config: { maxDecode: 20, timeoutMs: 6500 },
  },
  {
    type: 'http',
    name: '自定义 HTTP 渠道',
    baseUrl: '',
    description: '接入任意返回 JSON 的搜索 API，通过字段映射转换结果。',
    config: {
      search: {
        method: 'GET',
        url: '/api/search?kw={queryEncoded}',
      },
      itemsPath: 'data.list',
      fields: {
        title: 'title',
        url: 'url',
        password: 'password',
        cloudType: 'cloud_type',
        note: 'note',
        datetime: 'datetime',
      },
      maxResults: 50,
    },
  },
];
