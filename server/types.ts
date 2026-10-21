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

export interface CollectionItem extends Subject {
  cardSubtitle?: string;
  description?: string;
}

export interface CollectionSection {
  key: string;
  title: string;
  subtitle?: string;
  type: MediaType;
  items: Subject[];
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
}

export interface SearchQuery {
  title: string;
  year?: string;
  type?: MediaType | '';
  subjectId?: string;
  cloudType?: CloudType | 'all';
  maxResults?: number;
}

export interface NormalizedLink {
  title: string;
  url: string;
  password: string;
  cloudType: CloudType;
  note: string;
  datetime: string;
  channelId: string;
  channelName: string;
  raw?: unknown;
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
  links: NormalizedLink[];
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

export interface QuarkFile {
  fid: string;
  name: string;
  size: number;
  isDir: boolean;
  path: string;
  directUrl?: string;
  proxyUrl?: string;
}

export interface QuarkResolveResult {
  shareId: string;
  files: QuarkFile[];
  message?: string;
}
