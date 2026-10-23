import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import dotenv from 'dotenv';

dotenv.config({ override: true });

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

// 版本号统一从 package.json 读取，避免发版时多处手改
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
) as { version?: string };

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const config = {
  port: num(process.env.PORT, 8787),
  host: process.env.HOST || '127.0.0.1',
  root,
  version: pkg.version || '0.0.0',
  dataDir,
  dbPath: process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.join(dataDir, 'yingchao.db'),
  pansouBaseUrl: (process.env.PANSOU_BASE_URL || 'http://localhost:8888').replace(/\/$/, ''),
  // 启动影巢时自动拉起本机 PanSou（仅当 PanSou 地址指向本机时生效）。
  pansouAutostart: process.env.PANSOU_AUTOSTART !== 'false',
  pansouBin: process.env.PANSOU_BIN || '',
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
  nodeEnv: process.env.NODE_ENV || 'development',
  // 播放代理模式：'tunnel'=走 Cloudflare Tunnel 域名，'direct'=直连 IP
  playProxyMode: (process.env.PLAY_PROXY_MODE as 'tunnel' | 'direct') || 'tunnel',
  // 直连模式下的公网/IP 地址（不含协议和端口，如 192.168.1.100 或 yingchao.example.com）
  publicIp: process.env.PUBLIC_IP || '',
  // 从公网域名访问且客户端和服务器在同一家庭网络时，自动跳到局域网直连（播放不再绕 Cloudflare）
  autoLanRedirect: process.env.AUTO_LAN_REDIRECT !== 'false',
  // 有多块网卡时可手动指定局域网地址，不填则自动选择 en0 / 192.168.x
  lanIp: process.env.LAN_IP || '',
  userAgent:
    process.env.USER_AGENT ||
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

export type AppConfig = typeof config;
