import { Agent, fetch as undiciFetch } from 'undici';
import { getSetting } from './db.js';

// 夸克等国内网盘的网络线路策略：
// - auto   直连优先，失败退回 .env 配置的代理（默认，实测直连更快）
// - proxy  代理优先，失败退回直连
// - direct 只用直连
export type QuarkNetworkMode = 'auto' | 'proxy' | 'direct';

const directAgent = new Agent({ keepAliveTimeout: 30_000 });

function hasProxyEnv(): boolean {
  return Boolean(process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY);
}

function directFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  return undiciFetch(
    input as never,
    Object.assign({}, init, { dispatcher: directAgent }) as never,
  ) as unknown as Promise<Response>;
}

function proxyFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(input as never, init as never) as unknown as Promise<Response>;
}

export function getQuarkNetworkMode(): QuarkNetworkMode {
  const value = getSetting<string>('quark_network_mode');
  return value === 'proxy' || value === 'direct' ? value : 'auto';
}

export async function quarkFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const mode = getQuarkNetworkMode();
  if (!hasProxyEnv() || mode === 'direct') return directFetch(input, init);
  if (mode === 'proxy') {
    try {
      return await proxyFetch(input, init);
    } catch {
      return directFetch(input, init);
    }
  }
  try {
    return await directFetch(input, init);
  } catch {
    return proxyFetch(input, init);
  }
}
