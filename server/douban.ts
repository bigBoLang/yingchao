import { config } from './config.js';
import { smartFetch } from './direct-fetch.js';
import {
  getCollectionSubjects,
  getCollectionUpdatedAt,
  getSubject,
  now,
  saveCollection,
  upsertSubject,
} from './db.js';
import type { CollectionItem, MediaType, Subject } from './types.js';

interface CollectionDef {
  title: string;
  subtitle: string;
  type: MediaType;
  count: number;
}

export const COLLECTIONS: Record<string, CollectionDef> = {
  movie_showing: {
    title: '正在热映',
    subtitle: '大银幕上的新鲜故事',
    type: 'movie',
    count: 30,
  },
  tv_hot: {
    title: '热门剧集',
    subtitle: '最近大家都在追',
    type: 'tv',
    count: 48,
  },
  movie_weekly_best: {
    title: '一周口碑榜',
    subtitle: '本周观众选出的好片',
    type: 'movie',
    count: 20,
  },
  movie_top250: {
    title: '豆瓣电影 Top 250',
    subtitle: '时间验证过的经典',
    type: 'movie',
    count: 250,
  },
  tv_domestic: {
    title: '国产剧集',
    subtitle: '华语剧集精选',
    type: 'tv',
    count: 50,
  },
  tv_american: {
    title: '欧美剧集',
    subtitle: '来自大洋彼岸的故事',
    type: 'tv',
    count: 50,
  },
};

export const HOME_SECTION_KEYS = [
  'movie_showing',
  'tv_hot',
  'movie_weekly_best',
  'movie_top250',
  'tv_domestic',
  'tv_american',
];

let lastRequestAt = 0;
let queue: Promise<void> = Promise.resolve();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Douban 对频率比较敏感，这里用轻量串行队列控制请求间隔。 */
function schedule<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = Math.max(0, 140 - (Date.now() - lastRequestAt));
    if (wait > 0) await sleep(wait);
    try {
      return await task();
    } finally {
      lastRequestAt = Date.now();
    }
  });
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function doubanFetch(url: string, timeoutMs = 12000): Promise<Response> {
  const response = await smartFetch(url, {
    headers: {
      'User-Agent': config.userAgent,
      Referer: 'https://movie.douban.com/',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`豆瓣接口 ${response.status}`);
  }
  return response;
}

function parseCardSubtitle(card: string | undefined): {
  year: string;
  countries: string[];
  genres: string[];
  directors: string[];
  actors: string[];
} {
  if (!card) return { year: '', countries: [], genres: [], directors: [], actors: [] };
  const parts = card.split(' / ');
  const year = parts[0]?.match(/\d{4}/)?.[0] || '';
  const countries = (parts[1] || '').split(/\s+/).filter(Boolean);
  const genres = (parts[2] || '').split(/\s+/).filter(Boolean);
  const directors = (parts[3] || '').split(/\s+/).filter(Boolean);
  const actors = (parts[4] || '').split(/\s+/).filter(Boolean);
  return { year, countries, genres, directors, actors };
}

function normalizeCollectionItem(raw: Record<string, any>): CollectionItem {
  const parsed = parseCardSubtitle(raw.card_subtitle);
  const rating = raw.rating || {};
  const cover = raw.cover_url || raw.pic?.large || raw.pic?.normal || raw.cover?.url || '';
  const type: MediaType = raw.type === 'tv' || raw.subtype === 'tv' ? 'tv' : 'movie';
  return {
    id: String(raw.id),
    type,
    title: String(raw.title || ''),
    originalTitle: '',
    year: String(raw.year || parsed.year || ''),
    poster: cover,
    rating: Number(rating.value || 0),
    ratingCount: Number(rating.count || 0),
    genres: parsed.genres,
    countries: parsed.countries,
    directors: parsed.directors,
    actors: parsed.actors,
    aka: [],
    intro: String(raw.description || raw.comment || ''),
    episodes: 0,
    episodesInfo: String(raw.episodes_info || ''),
    duration: '',
    pubdate: [],
    rank: raw.rank == null ? null : Number(raw.rank),
    detailFetchedAt: 0,
  };
}

export async function fetchCollection(
  key: string,
  opts: { start?: number; count?: number; persist?: boolean } = {},
): Promise<{ items: CollectionItem[]; total: number }> {
  const def = COLLECTIONS[key];
  if (!def) throw new Error(`未知的豆瓣榜单：${key}`);
  const start = opts.start || 0;
  const count = Math.min(250, opts.count || def.count);
  const url = `https://m.douban.com/rexxar/api/v2/subject_collection/${key}/items?start=${start}&count=${count}`;
  const response = await schedule(() => doubanFetch(url));
  const data = (await response.json()) as {
    subject_collection_items?: Record<string, any>[];
    total?: number;
  };
  const items = (data.subject_collection_items || [])
    .map(normalizeCollectionItem)
    .filter((item) => item.id && item.title);
  if (opts.persist !== false && start === 0) {
    saveCollection(key, items, data.total);
  }
  return { items, total: Number(data.total || items.length) };
}

export async function refreshAllCollections(
  onProgress?: (key: string, count: number, error?: string) => void,
): Promise<void> {
  for (const key of HOME_SECTION_KEYS) {
    try {
      const result = await fetchCollection(key, { count: COLLECTIONS[key].count });
      onProgress?.(key, result.items.length);
    } catch (error) {
      onProgress?.(key, 0, error instanceof Error ? error.message : String(error));
    }
  }
}

export async function ensureCollection(key: string, maxAgeHours: number): Promise<Subject[]> {
  const updatedAt = getCollectionUpdatedAt(key);
  if (now() - updatedAt > maxAgeHours * 3600) {
    try {
      await fetchCollection(key, { count: COLLECTIONS[key]?.count || 30 });
    } catch (error) {
      console.error(`[douban] 刷新榜单 ${key} 失败：`, error);
    }
  }
  return getCollectionSubjects(key, 30);
}

export async function getHomeSections(): Promise<
  Array<{ key: string; title: string; subtitle: string; type: MediaType; items: Subject[] }>
> {
  const result: Array<{
    key: string;
    title: string;
    subtitle: string;
    type: MediaType;
    items: Subject[];
  }> = [];
  for (const key of HOME_SECTION_KEYS) {
    const items = await ensureCollection(key, config.collectionRefreshHours);
    const def = COLLECTIONS[key];
    if (items.length) {
      result.push({
        key,
        title: def.title,
        subtitle: def.subtitle,
        type: def.type,
        items,
      });
    }
  }
  return result;
}

interface SuggestItem {
  id: string;
  title: string;
  year?: string;
  type?: string;
  img?: string;
  sub_title?: string;
}

export async function searchSubjects(
  query: string,
  limit = 12,
): Promise<Subject[]> {
  const q = query.trim();
  if (!q) return [];
  const url = `https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(q)}`;
  const response = await schedule(() => doubanFetch(url));
  const raw = (await response.json()) as SuggestItem[];
  const filtered = raw
    .filter((item) => item.id && item.title && (item.type === 'movie' || item.type === 'tv'))
    .slice(0, Math.min(20, limit));

  const results: Subject[] = filtered.map((item) => ({
    id: item.id,
    type: item.type === 'tv' ? 'tv' : 'movie',
    title: item.title,
    originalTitle: item.sub_title || '',
    year: item.year || '',
    poster: item.img || '',
    rating: 0,
    ratingCount: 0,
    genres: [],
    countries: [],
    directors: [],
    actors: [],
    aka: [],
    intro: '',
    episodes: 0,
    episodesInfo: '',
    duration: '',
    pubdate: [],
    rank: null,
    detailFetchedAt: 0,
  }));

  // 用已有缓存补全评分，缺失的少量结果并发抓详情；搜索页不必等待全部。
  const enriched = await Promise.allSettled(
    results.map(async (subject) => {
      const cached = getSubject(subject.id);
      if (cached?.detailFetchedAt && now() - cached.detailFetchedAt < 86400 * 7) {
        return { ...cached, type: subject.type } as Subject;
      }
      try {
        return await fetchSubjectDetail(subject.id, subject.type, false);
      } catch {
        return subject;
      }
    }),
  );
  return enriched.map((item, index) =>
    item.status === 'fulfilled' ? item.value : results[index],
  );
}

export async function fetchSubjectDetail(
  id: string,
  type: MediaType,
  persist = true,
): Promise<Subject> {
  const endpoint = `https://m.douban.com/rexxar/api/v2/${type}/${id}`;
  const response = await schedule(() => doubanFetch(endpoint));
  const raw = (await response.json()) as Record<string, any>;
  const rating = raw.rating || {};
  const details: Subject = {
    id: String(raw.id || id),
    type: (raw.type === 'tv' || raw.is_tv ? 'tv' : type) as MediaType,
    title: String(raw.title || ''),
    originalTitle: String(raw.original_title || ''),
    year: String(raw.year || ''),
    poster: String(raw.cover_url || raw.pic?.large || raw.pic?.normal || ''),
    rating: Number(rating.value || 0),
    ratingCount: Number(rating.count || 0),
    genres: Array.isArray(raw.genres) ? raw.genres.map(String) : [],
    countries: Array.isArray(raw.countries) ? raw.countries.map(String) : [],
    directors: Array.isArray(raw.directors)
      ? raw.directors.map((d: { name?: string }) => String(d.name || '')).filter(Boolean)
      : [],
    actors: Array.isArray(raw.actors)
      ? raw.actors.slice(0, 20).map((a: { name?: string }) => String(a.name || '')).filter(Boolean)
      : [],
    aka: Array.isArray(raw.aka) ? raw.aka.map(String) : [],
    intro: String(raw.intro || ''),
    episodes: Number(raw.episodes_count || 0),
    episodesInfo: String(raw.episodes_info || ''),
    duration: Array.isArray(raw.durations) ? String(raw.durations[0] || '') : '',
    pubdate: Array.isArray(raw.pubdate) ? raw.pubdate.map(String) : [],
    rank: null,
    detailFetchedAt: now(),
  };
  if (persist) upsertSubject(details);
  return details;
}

export async function ensureSubjectDetail(
  id: string,
  requestedType?: MediaType | '',
): Promise<Subject | null> {
  const cached = getSubject(id);
  if (cached?.detailFetchedAt && now() - cached.detailFetchedAt < config.metadataCacheHours * 3600) {
    return cached;
  }
  const type: MediaType | '' =
    requestedType || (cached?.type as MediaType | undefined) || '';
  const candidates: MediaType[] = type ? [type] : ['movie', 'tv'];
  for (const candidate of candidates) {
    try {
      const detail = await fetchSubjectDetail(id, candidate, true);
      if (detail.title) return detail;
    } catch {
      // 尝试另一种类型
    }
  }
  return cached;
}

export function posterProxy(url: string): string {
  if (!url) return '';
  return `/api/image?url=${encodeURIComponent(url)}`;
}
