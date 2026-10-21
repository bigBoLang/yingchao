import crypto from 'node:crypto';
import { config } from './config.js';
import { getAppSecret, getSetting } from './db.js';
import type { QuarkFile, QuarkResolveResult, Resource } from './types.js';

const QUARK_ORIGIN = 'https://drive-pc.quark.cn';
const QUARK_API = `${QUARK_ORIGIN}/1/clouddrive`;
const VIDEO_EXT = /\.(mp4|mkv|avi|mov|m4v|ts|webm|flv|wmv|rmvb|m2ts|iso)$/i;

export interface QuarkShareRef {
  shareId: string;
  password: string;
}

export function parseQuarkShare(url: string, password = ''): QuarkShareRef | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!/(^|\.)quark\.cn$/i.test(parsed.hostname)) return null;
    const match = parsed.pathname.match(/^\/s\/([A-Za-z0-9_-]+)/);
    if (!match) return null;
    const pwd =
      password ||
      parsed.searchParams.get('pwd') ||
      parsed.searchParams.get('password') ||
      parsed.searchParams.get('passcode') ||
      '';
    return { shareId: match[1], password: pwd };
  } catch {
    return null;
  }
}

export function getQuarkCookie(): string {
  return String(getSetting<string>('quark_cookie') || config.quarkCookie || '');
}

function quarkHeaders(cookie = ''): Record<string, string> {
  return {
    'User-Agent': config.userAgent,
    Referer: 'https://pan.quark.cn/',
    Origin: 'https://pan.quark.cn',
    Accept: 'application/json, text/plain, */*',
    ...(cookie ? { Cookie: cookie } : {}),
  };
}

function quarkErrorMessage(code: number, message?: string): string {
  const map: Record<number, string> = {
    41004: '分享文件不存在或已被删除',
    41006: '分享不存在或已失效',
    41008: '需要提取码',
    41009: '提取码错误',
    41010: '链接访问受限',
    41011: '分享已过期',
    31001: '需要登录（请配置夸克 Cookie）',
    31002: '登录状态已失效（请更新夸克 Cookie）',
  };
  return map[code] || message || `夸克接口错误 ${code}`;
}

export interface QuarkTokenResult {
  ok: boolean;
  status: 'valid' | 'invalid' | 'locked' | 'unknown';
  stoken?: string;
  code?: number;
  message: string;
}

export async function getQuarkShareToken(
  shareId: string,
  password = '',
): Promise<QuarkTokenResult> {
  try {
    const response = await fetch(
      `${QUARK_API}/share/sharepage/token?pr=ucpro&fr=pc&uc_param_str=`,
      {
        method: 'POST',
        headers: { ...quarkHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ pwd_id: shareId, passcode: password || '' }),
        signal: AbortSignal.timeout(10000),
      },
    );
    const body = (await response.json()) as {
      code?: number;
      message?: string;
      data?: { stoken?: string };
    };
    const code = Number(body.code ?? -1);
    if (code === 0 && body.data?.stoken) {
      return { ok: true, status: 'valid', stoken: body.data.stoken, code, message: '有效' };
    }
    if ([41004, 41006, 41011].includes(code)) {
      return { ok: false, status: 'invalid', code, message: quarkErrorMessage(code, body.message) };
    }
    if ([41008, 41009, 41010].includes(code)) {
      return { ok: false, status: 'locked', code, message: quarkErrorMessage(code, body.message) };
    }
    return {
      ok: false,
      status: 'unknown',
      code,
      message: quarkErrorMessage(code, body.message),
    };
  } catch (error) {
    return {
      ok: false,
      status: 'unknown',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function checkQuarkLink(
  url: string,
  password = '',
): Promise<{ status: Resource['status']; code: string; message: string }> {
  const ref = parseQuarkShare(url, password);
  if (!ref) return { status: 'unknown', code: 'parse', message: '无法识别的夸克链接' };
  const result = await getQuarkShareToken(ref.shareId, ref.password);
  return {
    status: result.status,
    code: result.code == null ? '' : String(result.code),
    message: result.message,
  };
}

interface QuarkListItem {
  fid?: string;
  file_name?: string;
  file_type?: number;
  dir?: boolean;
  size?: number;
  share_fid_token?: string;
  include_items?: number;
}

async function fetchShareDetail(
  shareId: string,
  stoken: string,
  pdirFid: string,
  cookie: string,
): Promise<QuarkListItem[]> {
  const params = new URLSearchParams({
    pr: 'ucpro',
    fr: 'pc',
    uc_param_str: '',
    pwd_id: shareId,
    stoken,
    pdir_fid: pdirFid,
    force: '0',
    _page: '1',
    _size: '100',
    _fetch_banner: '0',
    _fetch_share: '0',
    _fetch_total: '1',
    _sort: 'file_type:asc,file_name:asc',
  });
  const response = await fetch(`${QUARK_API}/share/sharepage/detail?${params.toString()}`, {
    headers: quarkHeaders(cookie),
    signal: AbortSignal.timeout(15000),
  });
  const body = (await response.json()) as {
    code?: number;
    message?: string;
    data?: { list?: QuarkListItem[] };
  };
  if (Number(body.code) !== 0) {
    throw new Error(quarkErrorMessage(Number(body.code), body.message));
  }
  return body.data?.list || [];
}

async function getDownloadUrl(
  shareId: string,
  stoken: string,
  item: QuarkListItem,
  cookie: string,
): Promise<string> {
  const response = await fetch(
    `${QUARK_API}/share/sharepage/download?pr=ucpro&fr=pc&uc_param_str=`,
    {
      method: 'POST',
      headers: { ...quarkHeaders(cookie), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fids: [item.fid],
        pwd_id: shareId,
        stoken,
        fids_token: [item.share_fid_token || ''],
      }),
      signal: AbortSignal.timeout(15000),
    },
  );
  const body = (await response.json()) as {
    code?: number;
    message?: string;
    data?: unknown;
  };
  if (Number(body.code) !== 0) {
    throw new Error(quarkErrorMessage(Number(body.code), body.message));
  }
  const data = body.data;
  const findUrl = (value: unknown): string => {
    if (!value) return '';
    if (typeof value === 'string' && /^https?:/i.test(value)) return value;
    if (Array.isArray(value)) {
      for (const entry of value) {
        const found = findUrl(entry);
        if (found) return found;
      }
      return '';
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      for (const key of ['download_url', 'url', 'play_url', 'downloadUrl']) {
        if (typeof record[key] === 'string' && /^https?:/i.test(record[key])) {
          return record[key];
        }
      }
      for (const entry of Object.values(record)) {
        const found = findUrl(entry);
        if (found) return found;
      }
    }
    return '';
  };
  return findUrl(data);
}

export async function resolveQuarkShare(
  url: string,
  password = '',
): Promise<QuarkResolveResult> {
  const ref = parseQuarkShare(url, password);
  if (!ref) throw new Error('不是有效的夸克分享链接');
  const cookie = getQuarkCookie();
  if (!cookie) {
    throw new Error(
      '解析播放需要先在「设置」中配置夸克 Cookie。未配置时仍可复制分享链接，在夸克 App/网页中打开。',
    );
  }
  const token = await getQuarkShareToken(ref.shareId, ref.password);
  if (!token.ok || !token.stoken) {
    throw new Error(token.message);
  }

  interface InternalFile extends QuarkFile {
    shareFidToken: string;
  }
  const files: InternalFile[] = [];
  const queue: Array<{ fid: string; path: string; depth: number }> = [
    { fid: '0', path: '', depth: 0 },
  ];
  let visited = 0;
  while (queue.length && visited < 40) {
    const current = queue.shift()!;
    visited++;
    const list = await fetchShareDetail(ref.shareId, token.stoken, current.fid, cookie);
    for (const item of list) {
      const name = item.file_name || '未命名';
      const path = current.path ? `${current.path}/${name}` : name;
      const isDir = Boolean(item.dir) || Number(item.file_type) === 0;
      if (isDir) {
        if (current.depth < 3) {
          queue.push({ fid: String(item.fid || ''), path, depth: current.depth + 1 });
        }
        continue;
      }
      files.push({
        fid: String(item.fid || ''),
        name,
        size: Number(item.size || 0),
        isDir: false,
        path,
        shareFidToken: String(item.share_fid_token || ''),
      });
    }
    if (!list.length && current.fid === '0') {
      throw new Error(
        '分享目录为空：Cookie 可能未生效，或该分享需要额外权限。请更新夸克 Cookie 后重试。',
      );
    }
  }

  const videos = files.filter((file) => VIDEO_EXT.test(file.name)).slice(0, 40);
  if (!videos.length) {
    return {
      shareId: ref.shareId,
      files,
      message: '没有识别到视频文件',
    };
  }

  const resolved: QuarkFile[] = [];
  for (const file of videos) {
    try {
      const directUrl = await getDownloadUrl(
        ref.shareId,
        token.stoken,
        { fid: file.fid, share_fid_token: file.shareFidToken },
        cookie,
      );
      if (directUrl) {
        const { shareFidToken: _token, ...publicFile } = file;
        resolved.push({
          ...publicFile,
          directUrl,
          proxyUrl: signPlayUrl(directUrl, 'https://pan.quark.cn/'),
        });
      } else {
        const { shareFidToken: _token, ...publicFile } = file;
        resolved.push(publicFile);
      }
    } catch {
      const { shareFidToken: _token, ...publicFile } = file;
      resolved.push(publicFile);
    }
  }

  return {
    shareId: ref.shareId,
    files: resolved,
    message: resolved.some((file) => file.proxyUrl)
      ? ''
      : '未能生成直链，可能是 Cookie 失效、分享受限或需要会员权限。可复制分享链接到夸克中打开。',
  };
}

export function signPlayUrl(url: string, referer = '', ttlSeconds = 6 * 3600): string {
  const payload = JSON.stringify({
    u: url,
    r: referer,
    e: Math.floor(Date.now() / 1000) + ttlSeconds,
  });
  const encoded = Buffer.from(payload).toString('base64url');
  const signature = crypto
    .createHmac('sha256', getAppSecret())
    .update(encoded)
    .digest('base64url');
  return `/api/play/${encoded}.${signature}`;
}

export function verifyPlayToken(token: string): { url: string; referer: string } | null {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  const expected = crypto
    .createHmac('sha256', getAppSecret())
    .update(encoded)
    .digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
      u?: string;
      r?: string;
      e?: number;
    };
    if (!payload.u || !payload.e || payload.e < Math.floor(Date.now() / 1000)) return null;
    return { url: payload.u, referer: payload.r || '' };
  } catch {
    return null;
  }
}

export function formatBytes(size: number): string {
  if (!size || size < 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = size;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[index]}`;
}
