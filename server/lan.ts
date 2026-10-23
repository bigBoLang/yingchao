import net from 'node:net';
import os from 'node:os';
import { config } from './config.js';
import { fetchWithMode } from './direct-fetch.js';

// 通过 Cloudflare Tunnel 访问时，浏览器拿到的播放地址就是隧道域名，
// 视频字节会绕一圈 Cloudflare，实测只有约 0.1 MB/s。
// 如果客户端和服务器在同一个家庭网络（出口公网 IP 相同），
// 直接把页面跳到局域网地址，播放就走内网，实测约 6 MB/s。

const PUBLIC_IP_TTL_MS = 10 * 60_000;
let publicIpCache: { at: number; ip: string | null } | null = null;

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function interfaceScore(name: string): number {
  if (name === 'en0') return 0;
  if (name === 'en1') return 1;
  if (/^(en|eth|wlan|wi-?fi)/i.test(name)) return 2;
  if (/^(utun|tun|tap|tailscale|docker|bridge|vmnet)/i.test(name)) return 9;
  return 5;
}

function addressScore(ip: string): number {
  if (ip.startsWith('192.168.')) return 0;
  if (ip.startsWith('10.')) return 1;
  return 2;
}

/** 本机可被局域网访问的 IPv4 地址，按「en0 → 192.168.x」优先排序。 */
export function lanAddresses(): string[] {
  if (config.lanIp && isPrivateIpv4(config.lanIp)) return [config.lanIp];
  const found: Array<{ name: string; address: string }> = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (!isPrivateIpv4(entry.address)) continue;
      found.push({ name, address: entry.address });
    }
  }
  found.sort(
    (a, b) =>
      interfaceScore(a.name) - interfaceScore(b.name) ||
      addressScore(a.address) - addressScore(b.address),
  );
  return [...new Set(found.map((item) => item.address))];
}

export function lanUrls(): string[] {
  return lanAddresses().map((ip) => `http://${ip}:${config.port}`);
}

function headerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function isLanHost(host: string): boolean {
  const name = host.toLowerCase().replace(/^\[|\]$/g, '').split(':')[0];
  if (!name) return false;
  if (name === 'localhost' || name === '::1' || name.endsWith('.local')) return true;
  return isPrivateIpv4(name);
}

/**
 * 服务器自己的公网出口 IP。
 * 只使用直连请求，避免代理把「代理 IP」误当成家庭公网 IP，
 * 否则所有走同一个代理的客户端都会被误判为同一局域网。
 */
export async function getServerPublicIp(): Promise<string | null> {
  if (config.publicIp && net.isIP(config.publicIp)) return config.publicIp;
  const now = Date.now();
  const ttl = publicIpCache?.ip ? PUBLIC_IP_TTL_MS : 60_000;
  if (publicIpCache && now - publicIpCache.at < ttl) {
    return publicIpCache.ip;
  }

  const endpoints = [
    'https://www.cloudflare.com/cdn-cgi/trace',
    'https://ifconfig.me/ip',
    'https://checkip.amazonaws.com',
  ];
  let ip: string | null = null;
  for (const url of endpoints) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetchWithMode(
        url,
        {
          signal: controller.signal,
          headers: { 'User-Agent': config.userAgent, Accept: 'text/plain' },
        },
        'direct',
      );
      const text = (await response.text()).slice(0, 4000);
      const trace = text.match(/^ip=([0-9a-f:.]+)$/im);
      const candidate = (trace?.[1] || text.trim()).trim();
      if (net.isIP(candidate)) {
        ip = candidate;
        break;
      }
    } catch {
      // 换下一个探测地址
    } finally {
      clearTimeout(timer);
    }
  }
  publicIpCache = { at: now, ip };
  return ip;
}

type LanRequest = {
  method: string;
  hostname: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
  raw?: { url?: string };
};

/** 请求是否来自和服务器相同的公网出口（通常是同一个家庭网络）。 */
export async function isSameNetwork(request: LanRequest): Promise<boolean> {
  const host = request.hostname || '';
  if (isLanHost(host)) return true;
  const clientIp = headerValue(request.headers['cf-connecting-ip']).split(',')[0].trim();
  if (!clientIp || !net.isIP(clientIp)) return false;
  const serverIp = await getServerPublicIp();
  return Boolean(serverIp && serverIp === clientIp);
}

/**
 * 命中「同一家庭网络」时返回局域网地址（含原始路径），否则返回 null。
 * 只在浏览器打开页面（Accept 包含 text/html）时生效，API 请求不受影响。
 */
export async function lanRedirectUrl(request: LanRequest): Promise<string | null> {
  if (!config.autoLanRedirect) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  if (!headerValue(request.headers.accept).includes('text/html')) return null;

  const rawUrl = request.raw?.url || request.url || '/';
  if (rawUrl.startsWith('/api/') || rawUrl.startsWith('/assets/')) return null;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl, 'http://local');
  } catch {
    return null;
  }
  if (parsed.searchParams.get('lan') === '0') return null;
  if (request.cookies?.yingchao_lan === 'off') return null;

  // 没有 Cloudflare 头说明不是从隧道域名进来的，不需要跳转。
  if (!headerValue(request.headers['cf-connecting-ip'])) return null;
  if (isLanHost(request.hostname)) return null;
  if (!(await isSameNetwork(request))) return null;

  const ip = lanAddresses()[0];
  if (!ip) return null;
  // 跳转地址里不保留 lan 开关参数。
  parsed.searchParams.delete('lan');
  const query = parsed.searchParams.toString();
  return `http://${ip}:${config.port}${parsed.pathname}${query ? `?${query}` : ''}${parsed.hash}`;
}
