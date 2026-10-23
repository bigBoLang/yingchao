import net from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { getSetting } from './db.js';

// 国内网盘等服务的网络线路策略：
// - auto   直连优先，失败退回 .env 配置的代理（默认，实测直连更快）
// - proxy  代理优先，失败退回直连
// - direct 只用直连
export type NetworkMode = 'auto' | 'proxy' | 'direct';

const directAgent = new Agent({ keepAliveTimeout: 30_000 });
// 代理探活结果缓存：代理软件开关后最多 10 秒生效，避免每个请求都做一次 TCP 连接。
const PROXY_PROBE_TTL_MS = 10_000;
const PROXY_PROBE_TIMEOUT_MS = 1200;

let proxyProbe: { at: number; reachable: boolean } | null = null;

function proxyUrl(): string {
  return (
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.ALL_PROXY ||
    ''
  );
}

function hasProxyEnv(): boolean {
  return Boolean(proxyUrl());
}

function proxyEndpoint(): { host: string; port: number } | null {
  const raw = proxyUrl();
  if (!raw) return null;
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
    const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
    if (!parsed.hostname || !port) return null;
    return { host: parsed.hostname, port };
  } catch {
    return null;
  }
}

/** 探测本地代理端口是否在监听，代理软件退出后就不会再白等连接超时。 */
async function proxyReachable(): Promise<boolean> {
  const now = Date.now();
  if (proxyProbe && now - proxyProbe.at < PROXY_PROBE_TTL_MS) {
    return proxyProbe.reachable;
  }
  const endpoint = proxyEndpoint();
  if (!endpoint) {
    proxyProbe = { at: now, reachable: false };
    return false;
  }
  const reachable = await new Promise<boolean>((resolve) => {
    const socket = net.connect({ host: endpoint.host, port: endpoint.port });
    const finish = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(PROXY_PROBE_TIMEOUT_MS, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
  proxyProbe = { at: now, reachable };
  return reachable;
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

export function getNetworkMode(): NetworkMode {
  const value = getSetting<string>('quark_network_mode');
  return value === 'proxy' || value === 'direct' ? value : 'auto';
}

// 兼容旧名字：设置页里这一项叫「夸克网络线路」。
export const getQuarkNetworkMode = getNetworkMode;

/**
 * 按指定策略请求上游：代理只是兜底，而不是唯一出口。
 * 这样无论本机代理开着还是关着，服务都不会因为 127.0.0.1:10808
 * 连不上而整体失效（典型场景：代理软件退出后 .env 里仍留着代理配置）。
 */
export async function fetchWithMode(
  input: string | URL | Request,
  init: RequestInit | undefined,
  mode: NetworkMode,
): Promise<Response> {
  // 没配置代理，或明确要求直连时，不做任何多余尝试。
  if (!hasProxyEnv() || mode === 'direct') return directFetch(input, init);

  const externalAbort = init?.signal;
  const aborted = () => Boolean(externalAbort?.aborted);

  if (mode === 'proxy') {
    try {
      return await proxyFetch(input, init);
    } catch (error) {
      if (aborted()) throw error;
      return directFetch(input, init);
    }
  }

  // auto：直连优先，失败再走代理。
  try {
    return await directFetch(input, init);
  } catch (error) {
    if (aborted()) throw error;
    return proxyFetch(input, init);
  }
}

/** 夸克相关请求：遵循设置页里的「网络线路」策略。 */
export function quarkFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  return fetchWithMode(input, init, getNetworkMode());
}

/**
 * 通用上游请求（豆瓣、检索渠道、移动云盘、巡检等）：
 * - 代理在线：优先走代理，失败回退直连（代理开着时保持原来的出口 IP 效果）
 * - 代理离线：直接直连，不再尝试连不上的代理端口
 * 视频流另有 direct-first 策略，避免大流量绕代理。
 */
export async function smartFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  if (!hasProxyEnv()) return directFetch(input, init);
  if (!(await proxyReachable())) return directFetch(input, init);
  try {
    return await proxyFetch(input, init);
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    return directFetch(input, init);
  }
}

/** 视频流/媒体分片：始终直连优先，代理仅作兜底，避免播放流量绕路。 */
export function mediaFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  return fetchWithMode(input, init, 'auto');
}
