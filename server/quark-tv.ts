import crypto from 'node:crypto';
import { getSetting, setSetting } from './db.js';
import { quarkFetch as fetch } from './direct-fetch.js';

// 夸克 TV 开放接口：https://open-api-drive.quark.cn
// 与 PC 端 Cookie 接口不同，它需要扫码换取的 access_token，
// 但返回的播放地址走视频 CDN（实测 4K 单连接可达 10+ MB/s）。
const TV_API = 'https://open-api-drive.quark.cn';
// 官方 /token 需要额外的 _timestamp 签名，TV 客户端扫码换 token 走的社区转发。
const TV_CODE_API = 'http://api.extscreen.com/quarkdrive';
const TV_CLIENT_ID = 'd3194e61504e493eb6222857bccfed94';
const TV_SIGN_KEY = 'kw2dvtd7p4t3pjl2d9ed9yc8yej8kw2d';
const TV_APP_VER = '1.8.2.2';
const TV_CHANNEL = 'GENERAL';
const TV_UA =
  'Mozilla/5.0 (Linux; U; Android 13; zh-cn; M2004J7AC Build/UKQ1.231108.001) AppleWebKit/533.1 (KHTML, like Gecko) Mobile Safari/533.1';
const LOGIN_TTL_MS = 5 * 60 * 1000;

interface TvToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface TvLoginSession {
  queryToken: string;
  createdAt: number;
}

const loginSessions = new Map<string, TvLoginSession>();

export interface QuarkTvLoginStart {
  id: string;
  qrData: string;
}

export interface QuarkTvPlayLink {
  url: string;
  via: 'streaming' | 'download';
  resolution?: string;
}

function getDeviceId(): string {
  let id = getSetting<string>('quark_tv_device_id');
  if (!id) {
    id = crypto.randomBytes(16).toString('hex');
    setSetting('quark_tv_device_id', id);
  }
  return id;
}

function deviceParams(): Record<string, string> {
  return {
    app_ver: TV_APP_VER,
    device_id: getDeviceId(),
    device_brand: 'Xiaomi',
    platform: 'tv',
    device_name: 'M2004J7AC',
    device_model: 'M2004J7AC',
    build_device: 'M2004J7AC',
    build_product: 'M2004J7AC',
    device_gpu: 'Adreno (TM) 550',
    activity_rect: '{}',
    channel: TV_CHANNEL,
  };
}

function signRequest(method: string, pathname: string) {
  const timestamp = String(Date.now());
  const token = crypto
    .createHash('sha256')
    .update(`${method}&${pathname}&${timestamp}&${TV_SIGN_KEY}`)
    .digest('hex');
  const reqId = crypto
    .createHash('md5')
    .update(getDeviceId() + timestamp)
    .digest('hex');
  return { timestamp, token, reqId };
}

async function tvRequest(
  pathname: string,
  query: Record<string, string>,
  accessToken = '',
): Promise<Record<string, unknown>> {
  const { timestamp, token, reqId } = signRequest('GET', pathname);
  const url = new URL(TV_API + pathname);
  const params = { access_token: accessToken, ...deviceParams(), req_id: reqId, ...query };
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': TV_UA,
      'x-pan-tm': timestamp,
      'x-pan-token': token,
      'x-pan-client-id': TV_CLIENT_ID,
    },
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`夸克 TV 接口返回异常：${text.slice(0, 120)}`);
  }
  const status = Number(body.status ?? 0);
  const errno = Number(body.errno ?? 0);
  if (status >= 400 || (errno !== 0 && status !== 0)) {
    throw new Error(
      String(body.error_info || `夸克 TV 接口错误 ${status || errno}`),
    );
  }
  return body;
}

function readToken(): TvToken | null {
  const accessToken = getSetting<string>('quark_tv_access_token');
  const refreshToken = getSetting<string>('quark_tv_refresh_token');
  const expiresAt = Number(getSetting<number>('quark_tv_expires_at') || 0);
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken, expiresAt };
}

function saveToken(accessToken: string, refreshToken: string, expiresIn: number) {
  setSetting('quark_tv_access_token', accessToken);
  setSetting('quark_tv_refresh_token', refreshToken);
  setSetting('quark_tv_expires_at', Date.now() + Math.max(60, expiresIn - 120) * 1000);
}

export function isQuarkTvLoggedIn(): boolean {
  return Boolean(getSetting<string>('quark_tv_refresh_token'));
}

export function isQuarkTvEnabled(): boolean {
  return isQuarkTvLoggedIn() && getSetting<boolean>('quark_tv_enabled', true) !== false;
}

export function getQuarkTvLinkMode(): 'streaming' | 'download' {
  const mode = getSetting<string>('quark_tv_link_mode', 'streaming');
  return mode === 'download' ? 'download' : 'streaming';
}

async function exchangeToken(payload: Record<string, string>): Promise<TvToken> {
  const { reqId } = signRequest('POST', '/token');
  // 官方 token 接口要求额外的 _timestamp 签名，这里沿用 TV 客户端扫码链路。
  const response = await fetch(`${TV_CODE_API}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...deviceParams(), req_id: reqId, ...payload }),
    signal: AbortSignal.timeout(20000),
  });
  const body = (await response.json()) as {
    code?: number;
    message?: string;
    data?: {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
  };
  const data = body.data || {};
  if (body.code !== 200 || !data.access_token) {
    throw new Error(body.message || '夸克 TV 换取 token 失败');
  }
  const token: TvToken = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || '',
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 0)) * 1000,
  };
  saveToken(token.accessToken, token.refreshToken, Number(data.expires_in || 0));
  return token;
}

async function getAccessToken(forceRefresh = false): Promise<string> {
  const token = readToken();
  if (!token) throw new Error('请先在设置中扫码登录夸克 TV');
  if (!forceRefresh && token.accessToken && token.expiresAt > Date.now()) {
    return token.accessToken;
  }
  const refreshed = await exchangeToken({ refresh_token: token.refreshToken });
  return refreshed.accessToken;
}

async function withToken<T>(run: (accessToken: string) => Promise<T>): Promise<T> {
  const token = await getAccessToken();
  try {
    return await run(token);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/token|登录|10001|11001/i.test(message)) {
      const next = await getAccessToken(true);
      return run(next);
    }
    throw error;
  }
}

export async function startQuarkTvLogin(): Promise<QuarkTvLoginStart> {
  const body = await tvRequest('/oauth/authorize', {
    auth_type: 'code',
    client_id: TV_CLIENT_ID,
    scope: 'netdisk',
    qrcode: '1',
    qr_width: '460',
    qr_height: '460',
  });
  const qrData = String(body.qr_data || '');
  const queryToken = String(body.query_token || '');
  if (!qrData || !queryToken) throw new Error('夸克 TV 没有返回登录二维码');
  const id = crypto.randomBytes(12).toString('base64url');
  loginSessions.set(id, { queryToken, createdAt: Date.now() });
  for (const [key, value] of loginSessions) {
    if (Date.now() - value.createdAt > LOGIN_TTL_MS) loginSessions.delete(key);
  }
  return { id, qrData: `data:image/jpeg;base64,${qrData}` };
}

export interface QuarkTvLoginPoll {
  status: 'waiting' | 'scanned' | 'ok' | 'expired';
  message: string;
}

export async function pollQuarkTvLogin(id: string): Promise<QuarkTvLoginPoll> {
  const session = loginSessions.get(id);
  if (!session || Date.now() - session.createdAt > LOGIN_TTL_MS) {
    loginSessions.delete(id);
    return { status: 'expired', message: '二维码已过期，请重新获取' };
  }
  const body = await tvRequest('/oauth/code', {
    client_id: TV_CLIENT_ID,
    scope: 'netdisk',
    query_token: session.queryToken,
  });
  const code = String(body.code || '');
  if (!code) return { status: 'waiting', message: '等待扫码' };
  await exchangeToken({ code });
  loginSessions.delete(id);
  return { status: 'ok', message: '夸克 TV 登录成功' };
}

export function logoutQuarkTv(): void {
  for (const key of [
    'quark_tv_access_token',
    'quark_tv_refresh_token',
    'quark_tv_expires_at',
  ]) {
    setSetting(key, '');
  }
}

interface TvVideoInfo {
  resolution?: string;
  accessable?: number;
  url?: string;
  width?: number;
  height?: number;
}

const RESOLUTION_ORDER = ['4k', '2k', 'super', 'high', 'normal', 'low'];

function rankResolution(value?: string): number {
  const index = RESOLUTION_ORDER.indexOf(String(value || ''));
  return index === -1 ? RESOLUTION_ORDER.length : index;
}

function pickStream(videos: TvVideoInfo[]): { url: string; resolution: string } | null {
  const usable = videos.filter((item) => item.url);
  usable.sort((a, b) => rankResolution(a.resolution) - rankResolution(b.resolution));
  const best = usable[0];
  if (!best?.url) return null;
  return { url: best.url, resolution: String(best.resolution || '') };
}

// TV 端的 streaming 是转码后的 MP4（4K 也可用），走视频 CDN，比原文件直链快得多。
// download 返回原文件直链，用于「原画」线路。
export async function resolveQuarkTvPlayUrl(
  fid: string,
  mode: 'streaming' | 'download' = getQuarkTvLinkMode(),
): Promise<QuarkTvPlayLink> {
  return withToken(async (accessToken) => {
    if (mode === 'streaming') {
      const body = (await tvRequest(
        '/file',
        {
          method: 'streaming',
          group_by: 'source',
          fid,
          resolution: 'low,normal,high,super,2k,4k',
          support: 'dolby_vision',
        },
        accessToken,
      )) as { data?: { video_info?: TvVideoInfo[] } };
      const picked = pickStream(body.data?.video_info || []);
      if (picked) return { url: picked.url, via: 'streaming' as const, resolution: picked.resolution };
    }
    const body = (await tvRequest(
      '/file',
      {
        method: 'download',
        group_by: 'source',
        fid,
        resolution: 'low,normal,high,super,2k,4k',
        support: 'dolby_vision',
      },
      accessToken,
    )) as { data?: { download_url?: string } };
    const url = String(body.data?.download_url || '');
    if (!url) throw new Error('夸克 TV 没有返回播放地址');
    return { url, via: 'download' as const };
  });
}
