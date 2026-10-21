import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { config } from './config.js';
import type {
  Channel,
  ChannelType,
  CloudType,
  CollectionItem,
  MediaType,
  NormalizedLink,
  Resource,
  Subject,
} from './types.js';

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  original_title TEXT DEFAULT '',
  year TEXT DEFAULT '',
  poster TEXT DEFAULT '',
  rating REAL DEFAULT 0,
  rating_count INTEGER DEFAULT 0,
  genres TEXT DEFAULT '[]',
  countries TEXT DEFAULT '[]',
  directors TEXT DEFAULT '[]',
  actors TEXT DEFAULT '[]',
  aka TEXT DEFAULT '[]',
  intro TEXT DEFAULT '',
  episodes INTEGER DEFAULT 0,
  episodes_info TEXT DEFAULT '',
  duration TEXT DEFAULT '',
  pubdate TEXT DEFAULT '[]',
  rank INTEGER,
  detail_json TEXT,
  detail_fetched_at INTEGER DEFAULT 0,
  views INTEGER DEFAULT 0,
  heat REAL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subjects_type_rating ON subjects(type, rating_count DESC);
CREATE INDEX IF NOT EXISTS idx_subjects_heat ON subjects(heat DESC);

CREATE TABLE IF NOT EXISTS collections (
  key TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  rank INTEGER DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (key, subject_id)
);
CREATE INDEX IF NOT EXISTS idx_collections_key_rank ON collections(key, rank);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  base_url TEXT DEFAULT '',
  enabled INTEGER DEFAULT 1,
  priority INTEGER DEFAULT 100,
  config TEXT DEFAULT '{}',
  last_ok_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  url_key TEXT UNIQUE NOT NULL,
  url TEXT NOT NULL,
  password TEXT DEFAULT '',
  title TEXT DEFAULT '',
  subject_id TEXT,
  query TEXT DEFAULT '',
  media_type TEXT DEFAULT '',
  year TEXT DEFAULT '',
  channel_id TEXT NOT NULL,
  channel_name TEXT DEFAULT '',
  cloud_type TEXT DEFAULT 'other',
  note TEXT DEFAULT '',
  datetime TEXT DEFAULT '',
  raw TEXT DEFAULT '{}',
  status TEXT DEFAULT 'unknown',
  status_code TEXT DEFAULT '',
  status_message TEXT DEFAULT '',
  checked_at INTEGER DEFAULT 0,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  fail_count INTEGER DEFAULT 0,
  match_score REAL DEFAULT 0,
  direct_json TEXT,
  direct_at INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_resources_subject ON resources(subject_id, status);
CREATE INDEX IF NOT EXISTS idx_resources_checked ON resources(checked_at);
CREATE INDEX IF NOT EXISTS idx_resources_cloud ON resources(cloud_type, status);

CREATE TABLE IF NOT EXISTS subject_searches (
  subject_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  query TEXT DEFAULT '',
  searched_at INTEGER NOT NULL,
  ok INTEGER DEFAULT 1,
  error TEXT DEFAULT '',
  PRIMARY KEY (subject_id, channel_id)
);

CREATE TABLE IF NOT EXISTS search_cache (
  key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT DEFAULT '',
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_jobs_name ON jobs(name, started_at DESC);
`);

export const now = () => Math.floor(Date.now() / 1000);

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function getSetting<T = string>(key: string, fallback?: T): T | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return row.value as unknown as T;
  }
}

export function setSetting(key: string, value: unknown): void {
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, JSON.stringify(value));
}

export function getAppSecret(): string {
  if (config.appSecret && config.appSecret !== 'change-me-in-production') return config.appSecret;
  let secret = getSetting<string>('app_secret');
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    setSetting('app_secret', secret);
  }
  return secret;
}

function rowToSubject(row: Record<string, unknown>): Subject {
  return {
    id: String(row.id),
    type: row.type as MediaType,
    title: String(row.title || ''),
    originalTitle: String(row.original_title || ''),
    year: String(row.year || ''),
    poster: String(row.poster || ''),
    rating: Number(row.rating || 0),
    ratingCount: Number(row.rating_count || 0),
    genres: parseJson<string[]>(row.genres, []),
    countries: parseJson<string[]>(row.countries, []),
    directors: parseJson<string[]>(row.directors, []),
    actors: parseJson<string[]>(row.actors, []),
    aka: parseJson<string[]>(row.aka, []),
    intro: String(row.intro || ''),
    episodes: Number(row.episodes || 0),
    episodesInfo: String(row.episodes_info || ''),
    duration: String(row.duration || ''),
    pubdate: parseJson<string[]>(row.pubdate, []),
    rank: row.rank == null ? null : Number(row.rank),
    views: Number(row.views || 0),
    heat: Number(row.heat || 0),
    detailFetchedAt: Number(row.detail_fetched_at || 0),
  };
}

export function rowToResource(row: Record<string, unknown>): Resource {
  return {
    id: String(row.id),
    urlKey: String(row.url_key),
    url: String(row.url),
    password: String(row.password || ''),
    title: String(row.title || ''),
    subjectId: row.subject_id ? String(row.subject_id) : null,
    query: String(row.query || ''),
    mediaType: String(row.media_type || ''),
    year: String(row.year || ''),
    channelId: String(row.channel_id),
    channelName: String(row.channel_name || ''),
    cloudType: String(row.cloud_type || 'other') as CloudType,
    note: String(row.note || ''),
    datetime: String(row.datetime || ''),
    status: (row.status || 'unknown') as Resource['status'],
    statusCode: String(row.status_code || ''),
    statusMessage: String(row.status_message || ''),
    checkedAt: Number(row.checked_at || 0),
    firstSeenAt: Number(row.first_seen_at || 0),
    lastSeenAt: Number(row.last_seen_at || 0),
    failCount: Number(row.fail_count || 0),
    matchScore: Number(row.match_score || 0),
  };
}

function rowToChannel(row: Record<string, unknown>): Channel {
  return {
    id: String(row.id),
    name: String(row.name),
    type: String(row.type) as ChannelType,
    baseUrl: String(row.base_url || ''),
    enabled: Boolean(row.enabled),
    priority: Number(row.priority || 100),
    config: parseJson<Record<string, unknown>>(row.config, {}),
    lastOkAt: row.last_ok_at == null ? null : Number(row.last_ok_at),
    lastError: row.last_error == null ? null : String(row.last_error),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export function upsertSubject(subject: Subject): Subject {
  const t = now();
  db.prepare(`
    INSERT INTO subjects (
      id, type, title, original_title, year, poster, rating, rating_count, genres, countries,
      directors, actors, aka, intro, episodes, episodes_info, duration, pubdate, rank,
      detail_fetched_at, created_at, updated_at
    ) VALUES (
      @id, @type, @title, @originalTitle, @year, @poster, @rating, @ratingCount, @genres, @countries,
      @directors, @actors, @aka, @intro, @episodes, @episodesInfo, @duration, @pubdate, @rank,
      @detailFetchedAt, @createdAt, @updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      type = excluded.type,
      title = excluded.title,
      original_title = CASE WHEN excluded.original_title <> '' THEN excluded.original_title ELSE subjects.original_title END,
      year = CASE WHEN excluded.year <> '' THEN excluded.year ELSE subjects.year END,
      poster = CASE WHEN excluded.poster <> '' THEN excluded.poster ELSE subjects.poster END,
      rating = CASE WHEN excluded.rating > 0 THEN excluded.rating ELSE subjects.rating END,
      rating_count = CASE WHEN excluded.rating_count > 0 THEN excluded.rating_count ELSE subjects.rating_count END,
      genres = CASE WHEN excluded.genres <> '[]' THEN excluded.genres ELSE subjects.genres END,
      countries = CASE WHEN excluded.countries <> '[]' THEN excluded.countries ELSE subjects.countries END,
      directors = CASE WHEN excluded.directors <> '[]' THEN excluded.directors ELSE subjects.directors END,
      actors = CASE WHEN excluded.actors <> '[]' THEN excluded.actors ELSE subjects.actors END,
      aka = CASE WHEN excluded.aka <> '[]' THEN excluded.aka ELSE subjects.aka END,
      intro = CASE WHEN excluded.intro <> '' THEN excluded.intro ELSE subjects.intro END,
      episodes = CASE WHEN excluded.episodes > 0 THEN excluded.episodes ELSE subjects.episodes END,
      episodes_info = CASE WHEN excluded.episodes_info <> '' THEN excluded.episodes_info ELSE subjects.episodes_info END,
      duration = CASE WHEN excluded.duration <> '' THEN excluded.duration ELSE subjects.duration END,
      pubdate = CASE WHEN excluded.pubdate <> '[]' THEN excluded.pubdate ELSE subjects.pubdate END,
      rank = COALESCE(excluded.rank, subjects.rank),
      detail_fetched_at = MAX(excluded.detail_fetched_at, subjects.detail_fetched_at),
      updated_at = excluded.updated_at
  `).run({
    id: subject.id,
    type: subject.type,
    title: subject.title,
    originalTitle: subject.originalTitle || '',
    year: subject.year || '',
    poster: subject.poster || '',
    rating: subject.rating || 0,
    ratingCount: subject.ratingCount || 0,
    genres: JSON.stringify(subject.genres || []),
    countries: JSON.stringify(subject.countries || []),
    directors: JSON.stringify(subject.directors || []),
    actors: JSON.stringify(subject.actors || []),
    aka: JSON.stringify(subject.aka || []),
    intro: subject.intro || '',
    episodes: subject.episodes || 0,
    episodesInfo: subject.episodesInfo || '',
    duration: subject.duration || '',
    pubdate: JSON.stringify(subject.pubdate || []),
    rank: subject.rank ?? null,
    detailFetchedAt: subject.detailFetchedAt || 0,
    createdAt: t,
    updatedAt: t,
  });
  return getSubject(subject.id)!;
}

export function getSubject(id: string): Subject | null {
  const row = db.prepare('SELECT * FROM subjects WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToSubject(row) : null;
}

export function touchSubject(id: string): void {
  db.prepare(
    'UPDATE subjects SET views = views + 1, heat = heat + 1, updated_at = ? WHERE id = ?',
  ).run(now(), id);
}

export function listSubjects(opts: {
  type?: MediaType | '';
  genre?: string;
  sort?: 'rating' | 'heat' | 'new' | 'views';
  page?: number;
  pageSize?: number;
}): { items: Subject[]; total: number; page: number; pageSize: number } {
  const page = Math.max(1, opts.page || 1);
  const pageSize = Math.min(60, Math.max(1, opts.pageSize || 24));
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.type) {
    where.push('type = ?');
    params.push(opts.type);
  }
  if (opts.genre) {
    where.push('genres LIKE ?');
    params.push(`%"${opts.genre}"%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order =
    opts.sort === 'rating'
      ? 'rating DESC, rating_count DESC'
      : opts.sort === 'new'
        ? 'CAST(year AS INTEGER) DESC, updated_at DESC'
        : opts.sort === 'views'
          ? 'views DESC, heat DESC'
          : 'heat DESC, rating_count DESC, updated_at DESC';
  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM subjects ${whereSql}`).get(...params) as { c: number }
  ).c;
  const rows = db
    .prepare(`SELECT * FROM subjects ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
  return { items: rows.map(rowToSubject), total, page, pageSize };
}

export function saveCollection(
  key: string,
  items: CollectionItem[],
  total?: number,
): void {
  const t = now();
  const insert = db.prepare(
    'INSERT OR REPLACE INTO collections(key, subject_id, rank, updated_at) VALUES(?, ?, ?, ?)',
  );
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM collections WHERE key = ?').run(key);
    items.forEach((item, index) => {
      upsertSubject({ ...item, rank: item.rank ?? index + 1 });
      insert.run(key, item.id, item.rank ?? index + 1, t);
    });
    setSetting(`collection_meta:${key}`, { total: total ?? items.length, updatedAt: t });
  });
  tx();
}

export function getCollectionSubjects(key: string, limit = 30): Subject[] {
  const rows = db
    .prepare(
      `SELECT s.* FROM collections c JOIN subjects s ON s.id = c.subject_id
       WHERE c.key = ? ORDER BY c.rank ASC LIMIT ?`,
    )
    .all(key, limit) as Record<string, unknown>[];
  return rows.map(rowToSubject);
}

export function getCollectionUpdatedAt(key: string): number {
  const meta = getSetting<{ updatedAt?: number }>(`collection_meta:${key}`);
  return meta?.updatedAt || 0;
}

export function listCollections(): Array<{ key: string; count: number; updatedAt: number }> {
  const rows = db
    .prepare(
      'SELECT key, COUNT(*) AS count, MAX(updated_at) AS updated_at FROM collections GROUP BY key',
    )
    .all() as Array<{ key: string; count: number; updated_at: number }>;
  return rows.map((r) => ({ key: r.key, count: r.count, updatedAt: r.updated_at }));
}

export function listChannels(onlyEnabled = false): Channel[] {
  const rows = db
    .prepare(
      `SELECT * FROM channels ${onlyEnabled ? 'WHERE enabled = 1' : ''} ORDER BY priority ASC, created_at ASC`,
    )
    .all() as Record<string, unknown>[];
  return rows.map(rowToChannel);
}

export function getChannel(id: string): Channel | null {
  const row = db.prepare('SELECT * FROM channels WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToChannel(row) : null;
}

export function createChannel(input: {
  id?: string;
  name: string;
  type: ChannelType;
  baseUrl?: string;
  enabled?: boolean;
  priority?: number;
  config?: Record<string, unknown>;
}): Channel {
  const id = input.id || `ch_${crypto.randomBytes(6).toString('hex')}`;
  const t = now();
  db.prepare(`
    INSERT INTO channels(id, name, type, base_url, enabled, priority, config, created_at, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name,
    input.type,
    input.baseUrl || '',
    input.enabled === false ? 0 : 1,
    input.priority ?? 100,
    JSON.stringify(input.config || {}),
    t,
    t,
  );
  return getChannel(id)!;
}

export function updateChannel(
  id: string,
  patch: Partial<Pick<Channel, 'name' | 'type' | 'baseUrl' | 'enabled' | 'priority' | 'config'>>,
): Channel | null {
  const current = getChannel(id);
  if (!current) return null;
  db.prepare(`
    UPDATE channels SET name = ?, type = ?, base_url = ?, enabled = ?, priority = ?, config = ?, updated_at = ?
    WHERE id = ?
  `).run(
    patch.name ?? current.name,
    patch.type ?? current.type,
    patch.baseUrl ?? current.baseUrl,
    (patch.enabled ?? current.enabled) ? 1 : 0,
    patch.priority ?? current.priority,
    JSON.stringify(patch.config ?? current.config),
    now(),
    id,
  );
  return getChannel(id);
}

export function deleteChannel(id: string): boolean {
  return db.prepare('DELETE FROM channels WHERE id = ?').run(id).changes > 0;
}

export function channelHealth(id: string, ok: boolean, error?: string): void {
  // 失败时保留上一次成功时间，避免一次临时故障就让渠道被判定为“从未成功”。
  db.prepare(`
    UPDATE channels
    SET last_ok_at = CASE WHEN ? THEN ? ELSE last_ok_at END,
      last_error = ?,
      updated_at = ?
    WHERE id = ?
  `).run(ok ? 1 : 0, now(), error || null, now(), id);
}

export function resourceId(urlKey: string): string {
  return crypto.createHash('sha1').update(urlKey).digest('hex').slice(0, 20);
}

export function upsertResource(
  link: NormalizedLink,
  meta: {
    urlKey: string;
    subjectId?: string | null;
    query?: string;
    mediaType?: string;
    year?: string;
    matchScore?: number;
  },
): Resource {
  const t = now();
  const id = resourceId(meta.urlKey);
  db.prepare(`
    INSERT INTO resources(
      id, url_key, url, password, title, subject_id, query, media_type, year,
      channel_id, channel_name, cloud_type, note, datetime, raw, status,
      checked_at, first_seen_at, last_seen_at, match_score
    ) VALUES(
      @id, @urlKey, @url, @password, @title, @subjectId, @query, @mediaType, @year,
      @channelId, @channelName, @cloudType, @note, @datetime, @raw, 'unknown',
      0, @t, @t, @matchScore
    )
    ON CONFLICT(url_key) DO UPDATE SET
      title = excluded.title,
      password = CASE WHEN excluded.password <> '' THEN excluded.password ELSE resources.password END,
      subject_id = COALESCE(excluded.subject_id, resources.subject_id),
      query = excluded.query,
      media_type = excluded.media_type,
      year = excluded.year,
      channel_id = excluded.channel_id,
      channel_name = excluded.channel_name,
      cloud_type = excluded.cloud_type,
      note = CASE WHEN excluded.note <> '' THEN excluded.note ELSE resources.note END,
      datetime = CASE WHEN excluded.datetime <> '' THEN excluded.datetime ELSE resources.datetime END,
      raw = excluded.raw,
      last_seen_at = excluded.last_seen_at,
      match_score = excluded.match_score
  `).run({
    id,
    urlKey: meta.urlKey,
    url: link.url,
    password: link.password || '',
    title: link.title || '',
    subjectId: meta.subjectId || null,
    query: meta.query || '',
    mediaType: meta.mediaType || '',
    year: meta.year || '',
    channelId: link.channelId,
    channelName: link.channelName,
    cloudType: link.cloudType,
    note: link.note || '',
    datetime: link.datetime || '',
    raw: JSON.stringify(link.raw || {}),
    t,
    matchScore: meta.matchScore || 0,
  });
  return getResource(id)!;
}

export function getResource(id: string): Resource | null {
  const row = db.prepare('SELECT * FROM resources WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToResource(row) : null;
}

export function listResourcesForSubject(
  subjectId: string,
  cloudType?: CloudType | 'all',
  includeInvalid = false,
): Resource[] {
  const params: unknown[] = [subjectId];
  let sql = 'SELECT * FROM resources WHERE subject_id = ?';
  if (!includeInvalid) sql += " AND status <> 'invalid'";
  if (cloudType && cloudType !== 'all') {
    sql += ' AND cloud_type = ?';
    params.push(cloudType);
  }
  sql +=
    " ORDER BY CASE status WHEN 'valid' THEN 0 WHEN 'locked' THEN 1 WHEN 'unknown' THEN 2 ELSE 3 END, match_score DESC, last_seen_at DESC LIMIT 200";
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(rowToResource);
}

export function getResourceStatsForSubjects(ids: string[]): Record<string, number> {
  if (!ids.length) return {};
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT subject_id, COUNT(*) AS c FROM resources
       WHERE subject_id IN (${placeholders}) AND status <> 'invalid' GROUP BY subject_id`,
    )
    .all(...ids) as Array<{ subject_id: string; c: number }>;
  return Object.fromEntries(rows.map((r) => [r.subject_id, r.c]));
}

export function updateResourceCheck(
  id: string,
  status: Resource['status'],
  code: string,
  message: string,
): void {
  db.prepare(`
    UPDATE resources SET status = ?, status_code = ?, status_message = ?,
      checked_at = ?, fail_count = CASE WHEN ? = 'invalid' THEN fail_count + 1 ELSE 0 END
    WHERE id = ?
  `).run(status, code, message, now(), status, id);
}

export function listStaleResources(limit: number, checkedBefore: number): Resource[] {
  // 失效链接也会低频复检，避免临时故障导致资源永久隐藏；连续失败 5 次后停止。
  const rows = db
    .prepare(
      `SELECT * FROM resources
       WHERE (checked_at = 0 OR checked_at < ?)
         AND (status <> 'invalid' OR fail_count < 5)
       ORDER BY last_seen_at DESC LIMIT ?`,
    )
    .all(checkedBefore, limit) as Record<string, unknown>[];
  return rows.map(rowToResource);
}

export function markSubjectSearched(
  subjectId: string,
  channelId: string,
  query: string,
  ok: boolean,
  error = '',
): void {
  db.prepare(`
    INSERT INTO subject_searches(subject_id, channel_id, query, searched_at, ok, error)
    VALUES(?, ?, ?, ?, ?, ?)
    ON CONFLICT(subject_id, channel_id) DO UPDATE SET
      query = excluded.query, searched_at = excluded.searched_at,
      ok = excluded.ok, error = excluded.error
  `).run(subjectId, channelId, query, now(), ok ? 1 : 0, error);
}

export function getSubjectSearchState(subjectId: string): {
  lastSearchedAt: number;
  channels: Array<{ channelId: string; searchedAt: number; ok: boolean; error: string }>;
} {
  const rows = db
    .prepare('SELECT * FROM subject_searches WHERE subject_id = ?')
    .all(subjectId) as Array<{
    channel_id: string;
    searched_at: number;
    ok: number;
    error: string;
  }>;
  return {
    lastSearchedAt: rows.reduce((max, r) => Math.max(max, r.searched_at), 0),
    channels: rows.map((r) => ({
      channelId: r.channel_id,
      searchedAt: r.searched_at,
      ok: Boolean(r.ok),
      error: r.error || '',
    })),
  };
}

export function getTopHotSubjects(limit: number): Subject[] {
  const rows = db
    .prepare(
      `SELECT * FROM subjects WHERE type IN ('movie','tv')
       ORDER BY (views * 4 + heat + rating_count / 5000.0) DESC, updated_at DESC LIMIT ?`,
    )
    .all(limit) as Record<string, unknown>[];
  return rows.map(rowToSubject);
}

export function getStats(): {
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
  lastJob: { name: string; status: string; message: string; startedAt: number; finishedAt: number | null } | null;
} {
  const one = (sql: string, ...params: unknown[]) =>
    Number((db.prepare(sql).get(...params) as { c: number } | undefined)?.c || 0);
  const lastJob = db
    .prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT 1')
    .get() as Record<string, unknown> | undefined;
  return {
    subjects: one('SELECT COUNT(*) AS c FROM subjects'),
    movies: one("SELECT COUNT(*) AS c FROM subjects WHERE type = 'movie'"),
    tvs: one("SELECT COUNT(*) AS c FROM subjects WHERE type = 'tv'"),
    resources: one('SELECT COUNT(*) AS c FROM resources'),
    validResources: one("SELECT COUNT(*) AS c FROM resources WHERE status IN ('valid','locked')"),
    invalidResources: one("SELECT COUNT(*) AS c FROM resources WHERE status = 'invalid'"),
    channels: one('SELECT COUNT(*) AS c FROM channels'),
    enabledChannels: one('SELECT COUNT(*) AS c FROM channels WHERE enabled = 1'),
    searches: one('SELECT COUNT(*) AS c FROM subject_searches'),
    lastCollectionUpdate: one('SELECT COALESCE(MAX(updated_at),0) AS c FROM collections'),
    lastJob: lastJob
      ? {
          name: String(lastJob.name),
          status: String(lastJob.status),
          message: String(lastJob.message || ''),
          startedAt: Number(lastJob.started_at),
          finishedAt: lastJob.finished_at == null ? null : Number(lastJob.finished_at),
        }
      : null,
  };
}

export function startJob(name: string): number {
  const result = db
    .prepare("INSERT INTO jobs(name, status, message, started_at) VALUES(?, 'running', '', ?)")
    .run(name, now());
  return Number(result.lastInsertRowid);
}

export function finishJob(id: number, status: 'ok' | 'error', message = ''): void {
  db.prepare('UPDATE jobs SET status = ?, message = ?, finished_at = ? WHERE id = ?').run(
    status,
    message,
    now(),
    id,
  );
  db.prepare(
    'DELETE FROM jobs WHERE id NOT IN (SELECT id FROM jobs ORDER BY id DESC LIMIT 200)',
  ).run();
}

export function recoverStaleJobs(): void {
  db.prepare(
    "UPDATE jobs SET status = 'error', message = '服务重启，任务已中断', finished_at = ? WHERE status = 'running'",
  ).run(now());
}

export function listJobs(limit = 20): Array<{
  id: number;
  name: string;
  status: string;
  message: string;
  startedAt: number;
  finishedAt: number | null;
}> {
  const rows = db.prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT ?').all(limit) as Array<
    Record<string, unknown>
  >;
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    status: String(r.status),
    message: String(r.message || ''),
    startedAt: Number(r.started_at),
    finishedAt: r.finished_at == null ? null : Number(r.finished_at),
  }));
}

export function seedDefaults(): void {
  if (getSetting<boolean>('channels_seeded')) return;

  if (!getChannel('pansou-default')) {
    createChannel({
      id: 'pansou-default',
      name: 'PanSou（默认）',
      type: 'pansou',
      baseUrl: config.pansouBaseUrl,
      enabled: true,
      priority: 10,
      config: {},
    });
  }
  if (config.enableZhuyun && !getChannel('zhuyun-default')) {
    createChannel({
      id: 'zhuyun-default',
      name: '竹云盘搜',
      type: 'zhuyun',
      baseUrl: config.zhuyunBaseUrl,
      enabled: true,
      priority: 20,
      config: { maxDecode: 20, timeoutMs: 6500 },
    });
  }
  if (config.quarkCookie && getSetting('quark_cookie') == null) {
    setSetting('quark_cookie', config.quarkCookie);
  }
  if (getSetting('player_prefs') == null) {
    setSetting('player_prefs', {
      iina: true,
      vlc: true,
      potplayer: false,
      mpv: true,
      defaultExternal: 'iina',
    });
  }
  if (getSetting('runtime_settings') == null) {
    setSetting('runtime_settings', {
      searchCacheHours: config.searchCacheHours,
      validateHours: config.validateHours,
      hotRefreshHours: config.hotRefreshHours,
      hotRefreshLimit: config.hotRefreshLimit,
      schedulerEnabled: config.schedulerEnabled,
    });
  }
  setSetting('channels_seeded', true);
}

export function getRuntimeSettings(): {
  searchCacheHours: number;
  validateHours: number;
  hotRefreshHours: number;
  hotRefreshLimit: number;
  schedulerEnabled: boolean;
} {
  const merged = {
    searchCacheHours: config.searchCacheHours,
    validateHours: config.validateHours,
    hotRefreshHours: config.hotRefreshHours,
    hotRefreshLimit: config.hotRefreshLimit,
    schedulerEnabled: config.schedulerEnabled,
    ...(getSetting<Record<string, unknown>>('runtime_settings') || {}),
  } as {
    searchCacheHours: number;
    validateHours: number;
    hotRefreshHours: number;
    hotRefreshLimit: number;
    schedulerEnabled: boolean;
  };
  // 环境变量是硬开关：显式关闭时不允许被数据库里的旧设置覆盖。
  if (!config.schedulerEnabled) merged.schedulerEnabled = false;
  return merged;
}
