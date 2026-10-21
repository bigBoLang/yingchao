import { config } from '../config.js';
import {
  getRuntimeSettings,
  getSubject,
  getSubjectSearchState,
  listChannels,
  listResourcesForSubject,
  markSubjectSearched,
  now,
  upsertResource,
} from '../db.js';
import { dedupeLinks, runChannelSearches } from '../channels/index.js';
import { titleMatchScore, urlKeyFor } from '../channels/shared.js';
import { validateResources } from '../validator.js';
import type {
  ChannelSearchResult,
  CloudType,
  Resource,
  SearchQuery,
  SearchResponse,
  Subject,
} from '../types.js';

export async function searchSubjectResources(
  subject: Subject,
  opts: { force?: boolean; cloudType?: CloudType | 'all' } = {},
): Promise<SearchResponse> {
  const runtime = getRuntimeSettings();
  const cloudType = opts.cloudType || 'quark';
  const state = getSubjectSearchState(subject.id);
  const cachedResources = listResourcesForSubject(subject.id, cloudType, false);
  const fresh =
    state.lastSearchedAt > 0 &&
    now() - state.lastSearchedAt < runtime.searchCacheHours * 3600 &&
    cachedResources.length > 0;

  if (!opts.force && fresh) {
    return {
      query: subject.title,
      resources: cachedResources,
      channels: state.channels.map((channel) => ({
        channel:
          listChannels().find((item) => item.id === channel.channelId) ||
          ({
            id: channel.channelId,
            name: channel.channelId,
            type: 'http',
            baseUrl: '',
            enabled: true,
            priority: 999,
            config: {},
            lastOkAt: null,
            lastError: null,
            createdAt: 0,
            updatedAt: 0,
          } as ChannelSearchResult['channel']),
        links: [],
        error: channel.ok ? undefined : channel.error,
        ms: 0,
      })),
      cached: true,
      searchedAt: state.lastSearchedAt,
    };
  }

  const query: SearchQuery = {
    title: subject.title,
    year: subject.year,
    type: subject.type,
    subjectId: subject.id,
    cloudType,
    maxResults: 80,
  };
  const channels = listChannels(true);
  const results = await runChannelSearches(query, channels);
  const deduped = dedupeLinks(results, subject.title);
  // 只保留标题确实相关的链接；搜索源在关键词命不中时经常返回频道里的无关内容。
  const selected = deduped.filter((item) => item.score >= 0.18).slice(0, 80);

  const persisted: Resource[] = [];
  for (const { link, score } of selected) {
    persisted.push(
      upsertResource(link, {
        urlKey: urlKeyFor(link.url, link.password),
        subjectId: subject.id,
        query: subject.title,
        mediaType: subject.type,
        year: subject.year,
        matchScore: Math.round(score * 1000) / 1000,
      }),
    );
  }

  for (const result of results) {
    markSubjectSearched(
      subject.id,
      result.channel.id,
      subject.title,
      !result.error,
      result.error || '',
    );
  }

  // 新结果先同步检测一小批，让详情页立刻能显示有效/失效状态。
  const toCheck = persisted.filter((resource) => resource.status === 'unknown').slice(0, 8);
  if (toCheck.length) {
    await validateResources(toCheck, 4);
  }

  return {
    query: subject.title,
    resources: listResourcesForSubject(subject.id, cloudType, false),
    channels: results,
    cached: false,
    searchedAt: now(),
  };
}

export async function searchOtherSubject(
  title: string,
  opts: { force?: boolean; cloudType?: CloudType | 'all'; year?: string; type?: string } = {},
): Promise<SearchResponse> {
  const query: SearchQuery = {
    title,
    year: opts.year,
    type: (opts.type as SearchQuery['type']) || '',
    cloudType: opts.cloudType || 'quark',
    maxResults: 80,
  };
  const results = await runChannelSearches(query, listChannels(true));
  const deduped = dedupeLinks(results, title);
  const resources: Resource[] = deduped.slice(0, 80).map(({ link, score }) =>
    upsertResource(link, {
      urlKey: urlKeyFor(link.url, link.password),
      query: title,
      year: opts.year || '',
      mediaType: opts.type || '',
      matchScore: score,
    }),
  );
  if (resources.length) {
    await validateResources(resources.slice(0, 8), 4);
  }
  return {
    query: title,
    resources,
    channels: results,
    cached: false,
    searchedAt: now(),
  };
}

export async function getSubjectBundle(id: string): Promise<{
  subject: Subject | null;
  resources: Resource[];
  searchState: ReturnType<typeof getSubjectSearchState>;
  ttlHours: number;
}> {
  const subject = getSubject(id);
  const resources = subject ? listResourcesForSubject(subject.id, 'all', false) : [];
  return {
    subject,
    resources,
    searchState: getSubjectSearchState(id),
    ttlHours: config.searchCacheHours,
  };
}

export { titleMatchScore };
