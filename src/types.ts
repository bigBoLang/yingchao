export type MediaType = 'movie' | 'tv';

export type CloudType =
  | 'quark'
  | 'baidu'
  | 'aliyun'
  | 'uc'
  | 'xunlei'
  | '123'
  | '115'
  | 'tianyi'
  | 'mobile'
  | 'pikpak'
  | 'guangya'
  | 'magnet'
  | 'ed2k'
  | 'other';

export interface Subject {
  id: string;
  type: MediaType;
  title: string;
  originalTitle: string;
  year: string;
  poster: string;
  rating: number;
  ratingCount: number;
  genres: string[];
  countries: string[];
  directors: string[];
  actors: string[];
  aka: string[];
  intro: string;
  episodes: number;
  episodesInfo: string;
  duration: string;
  pubdate: string[];
  rank?: number | null;
  views?: number;
  heat?: number;
  detailFetchedAt?: number;
  resourceCount?: number;
}

export interface Section {
  key: string;
  title: string;
  subtitle: string;
  type: MediaType;
  items: Subject[];
}

export interface HomeResponse {
  hero: Subject | null;
  sections: Section[];
  stats: Stats;
}

export interface Stats {
  subjects: number;
  movies: number;
  tvs: number;
  resources: number;
  validResources: number;
  invalidResources: number;
  channels: number;
  enabledChannels: number;
  searches: number;
  lastCollectionUpdate: number;
  lastJob: {
    name: string;
    status: string;
    message: string;
    startedAt: number;
    finishedAt: number | null;
  } | null;
}

export type ChannelType = 'pansou' | 'zhuyun' | 'http';

export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  baseUrl: string;
  enabled: boolean;
  priority: number;
  config: Record<string, unknown>;
  lastOkAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
  hasApiKey?: boolean;
}

export interface Resource {
  id: string;
  urlKey: string;
  url: string;
  password: string;
  title: string;
  subjectId: string | null;
  query: string;
  mediaType: string;
  year: string;
  channelId: string;
  channelName: string;
  cloudType: CloudType;
  note: string;
  datetime: string;
  status: 'valid' | 'invalid' | 'locked' | 'unknown';
  statusCode: string;
  statusMessage: string;
  checkedAt: number;
  firstSeenAt: number;
  lastSeenAt: number;
  failCount: number;
  matchScore: number;
}

export interface ChannelSearchResult {
  channel: Channel;
  links: unknown[];
  error?: string;
  ms: number;
}

export interface SearchResponse {
  query: string;
  resources: Resource[];
  channels: ChannelSearchResult[];
  cached: boolean;
  searchedAt: number;
}

export interface SubjectBundle {
  subject: Subject;
  resources: Resource[];
  searchState: {
    lastSearchedAt: number;
    channels: Array<{ channelId: string; searchedAt: number; ok: boolean; error: string }>;
  };
  ttlHours: number;
  channels: Array<{
    id: string;
    name: string;
    type: ChannelType;
    enabled: boolean;
    lastOkAt: number | null;
    lastError: string | null;
  }>;
  shouldSearch: boolean;
}

export interface SearchSuggestResponse {
  query: string;
  items: Subject[];
  warning?: string;
}

export interface SettingsResponse {
  quarkCookieSet: boolean;
  quarkCookiePreview: string;
  player: {
    iina: boolean;
    vlc: boolean;
    potplayer: boolean;
    mpv: boolean;
    infuse: boolean;
    vlcIos: boolean;
    nplayer: boolean;
    defaultExternal: string;
  };
  runtime: RuntimeSettings;
  config: {
    port: number;
    dataDir: string;
    pansouBaseUrl: string;
    zhuyunBaseUrl: string;
  };
}

export interface RuntimeSettings {
  searchCacheHours: number;
  validateHours: number;
  hotRefreshHours: number;
  hotRefreshLimit: number;
  schedulerEnabled: boolean;
}

export interface Job {
  id: number;
  name: string;
  status: string;
  message: string;
  startedAt: number;
  finishedAt: number | null;
}

export interface AdminOverview {
  stats: Stats;
  jobs: Job[];
  collections: Array<{ key: string; count: number; updatedAt: number }>;
  collectionDefs: Record<string, { title: string; subtitle: string; type: MediaType; count: number }>;
  channels: Channel[];
  runtime: RuntimeSettings;
  quarkCookieSet: boolean;
  serverTime: number;
}

export interface QuarkFile {
  fid: string;
  name: string;
  size: number;
  isDir: boolean;
  path: string;
  directUrl?: string;
  proxyUrl?: string;
  sizeLabel?: string;
}

export interface ResolveResponse {
  shareId: string;
  files: QuarkFile[];
  message?: string;
  error?: string;
}
