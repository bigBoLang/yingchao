import dns from 'node:dns/promises';
import net from 'node:net';

// 用户可自定义渠道地址、资源里也可能出现任意直链，这些地址都会被服务端主动请求。
// 这里挡掉回环 / 内网 / 链路本地 / 保留地址，避免被用来探测内网服务。

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIPv6(ip: string): boolean {
  const value = ip.toLowerCase();
  if (value === '::' || value === '::1') return true;
  if (value.startsWith('fc') || value.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(value)) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return false;
}

/**
 * 校验一个出站 URL 是否指向公网。只做域名解析结果检查，
 * 不覆盖「公网域名 302 跳到内网」的情况（渠道请求已限定在已登录用户可配置）。
 */
export async function assertPublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('只允许 http/https 地址');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new Error('不允许访问内网地址');
  }
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('不允许访问内网地址');
    return url;
  }
  const records = await dns.lookup(host, { all: true }).catch(() => null);
  if (records?.some((record) => isPrivateAddress(record.address))) {
    throw new Error('不允许访问内网地址');
  }
  return url;
}
