import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

// 让服务端 fetch 遵循 HTTP(S)_PROXY / NO_PROXY。
// 某些公共搜索节点会按出口 IP 触发风控，配置本地代理后可以正常访问；
// NO_PROXY 里的本机地址（如 PanSou）仍然直连。
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
}

const root = process.cwd();
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(root, 'data');

fs.mkdirSync(dataDir, { recursive: true });

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const config = {
  port: num(process.env.PORT, 8787),
  host: process.env.HOST || '127.0.0.1',
  root,
  dataDir,
  dbPath: process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.join(dataDir, 'yingchao.db'),
  pansouBaseUrl: (process.env.PANSOU_BASE_URL || 'http://localhost:8888').replace(/\/$/, ''),
  zhuyunBaseUrl: (process.env.ZHUYUN_BASE_URL || 'https://pan.zhuyunso.top').replace(/\/$/, ''),
  enableZhuyun: process.env.ENABLE_ZHUYUN !== 'false',
  quarkCookie: process.env.QUARK_COOKIE || '',
  searchCacheHours: num(process.env.SEARCH_CACHE_HOURS, 12),
  metadataCacheHours: num(process.env.METADATA_CACHE_HOURS, 24),
  collectionRefreshHours: num(process.env.COLLECTION_REFRESH_HOURS, 6),
  hotRefreshHours: num(process.env.HOT_REFRESH_HOURS, 6),
  validateHours: num(process.env.VALIDATE_HOURS, 3),
  hotRefreshLimit: num(process.env.HOT_REFRESH_LIMIT, 12),
  validateBatch: num(process.env.VALIDATE_BATCH, 60),
  schedulerEnabled: process.env.SCHEDULER_ENABLED !== 'false',
  appSecret: process.env.APP_SECRET || '',
  userAgent:
    process.env.USER_AGENT ||
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

export type AppConfig = typeof config;
