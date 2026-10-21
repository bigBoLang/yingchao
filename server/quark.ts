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

const QUARK_SAVE_FOLDER = '影巢播放缓存';
const QUARK_ELECTRON_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/2.5.56 Chrome/100.0.4896.160 Electron/18.3.5.12-a038f7b798 Safari/537.36 Channel/pckk_other_ch';

interface QuarkDriveItem {
  fid?: string;
  file_name?: string;
  dir?: boolean;
  size?: number;
}

async function listDriveFolder(pdirFid: string, cookie: string): Promise<QuarkDriveItem[]> {
  const params = new URLSearchParams({
    pr: 'ucpro',
    fr: 'pc',
    uc_param_str: '',
    pdir_fid: pdirFid,
    _page: '1',
    _size: '200',
    _fetch_total: '1',
    _sort: 'file_type:asc,file_name:asc',
  });
  const response = await fetch(`${QUARK_API}/file/sort?${params.toString()}`, {
    headers: quarkHeaders(cookie),
    signal: AbortSignal.timeout(15000),
  });
  const body = (await response.json()) as {
    code?: number;
    message?: string;
    data?: { list?: QuarkDriveItem[] };
  };
  if (Number(body.code) !== 0) {
    throw new Error(quarkErrorMessage(Number(body.code), body.message));
  }
  return body.data?.list || [];
}

async function ensureSaveFolder(cookie: string): Promise<string> {
  const items = await listDriveFolder('0', cookie);
  const existing = items.find((item) => item.dir && item.file_name === QUARK_SAVE_FOLDER);
  if (existing?.fid) return String(existing.fid);

  const response = await fetch(`${QUARK_API}/file?pr=ucpro&fr=pc&uc_param_str=`, {
    method: 'POST',
    headers: { ...quarkHeaders(cookie), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pdir_fid: '0',
      file_name: QUARK_SAVE_FOLDER,
      dir_path: '',
      dir_init_lock: false,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const body = (await response.json()) as {
    code?: number;
    message?: string;
    data?: { fid?: string };
  };
  if (Number(body.code) === 0 && body.data?.fid) return String(body.data.fid);

  // 并发创建或重名时重新查一次
  const again = await listDriveFolder('0', cookie);
  const folder = again.find((item) => item.dir && item.file_name === QUARK_SAVE_FOLDER);
  if (folder?.fid) return String(folder.fid);
  throw new Error(body.message || '无法创建夸克转存目录');
}

async function resolveSaveTask(data: unknown, cookie: string): Promise<string> {
  const record = (data || {}) as {
    task_id?: string;
    task_resp?: {
      data?: { status?: number; save_as?: Record<string, string[]> };
    };
  };
  const immediate =
    record.task_resp?.data?.save_as?.save_as_top_fids?.[0] ||
    record.task_resp?.data?.save_as?.save_as_select_top_fids?.[0];
  if (immediate) return immediate;

  const taskId = record.task_id;
  if (!taskId) throw new Error('夸克没有返回转存任务');
  for (let index = 0; index < 30; index++) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    const params = new URLSearchParams({
      pr: 'ucpro',
      fr: 'pc',
      uc_param_str: '',
      task_id: taskId,
      retry_index: String(index),
    });
    const response = await fetch(`${QUARK_API}/task?${params.toString()}`, {
      headers: quarkHeaders(cookie),
      signal: AbortSignal.timeout(15000),
    });
    const body = (await response.json()) as {
      code?: number;
      message?: string;
      data?: { status?: number; save_as?: Record<string, string[]> };
    };
    if (Number(body.code) === 32003) {
      throw new Error('夸克网盘容量不足，无法转存这个文件');
    }
    if (Number(body.code) !== 0) {
      throw new Error(quarkErrorMessage(Number(body.code), body.message));
    }
    const saveAs = body.data?.save_as;
    const savedFid =
      saveAs?.save_as_top_fids?.[0] || saveAs?.save_as_select_top_fids?.[0];
    if (body.data?.status === 2 && savedFid) return savedFid;
    if (body.data?.status === 3) throw new Error('夸克转存任务失败');
  }
  throw new Error('夸克转存超时，请稍后重试');
}

async function saveShareFile(
  shareId: string,
  stoken: string,
  file: { fid: string; name: string; size: number; shareFidToken: string },
  folderFid: string,
  cookie: string,
): Promise<{ fid: string; reused: boolean }> {
  const existing = (await listDriveFolder(folderFid, cookie)).find(
    (item) =>
      !item.dir &&
      item.file_name === file.name &&
      (!file.size || Number(item.size || 0) === file.size),
  );
  if (existing?.fid) return { fid: String(existing.fid), reused: true };

  const response = await fetch(
    `${QUARK_API}/share/sharepage/save?pr=ucpro&fr=pc&uc_param_str=`,
    {
      method: 'POST',
      headers: { ...quarkHeaders(cookie), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fid_list: [file.fid],
        fid_token_list: [file.shareFidToken],
        to_pdir_fid: folderFid,
        pwd_id: shareId,
        stoken,
        pdir_fid: '0',
        scene: 'link',
      }),
      signal: AbortSignal.timeout(20000),
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
  return { fid: await resolveSaveTask(body.data, cookie), reused: false };
}

async function requestDownloadUrl(fid: string, cookie: string, ua: string): Promise<{
  code: number;
  message: string;
  url: string;
}> {
  const response = await fetch(
    `${QUARK_API}/file/download?pr=ucpro&fr=pc&uc_param_str=&sys=win32&ve=2.5.56&ut=&guid=`,
    {
      method: 'POST',
      headers: {
        ...quarkHeaders(cookie),
        'User-Agent': ua,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fids: [fid] }),
      signal: AbortSignal.timeout(20000),
    },
  );
  const body = (await response.json()) as {
    code?: number;
    message?: string;
    data?: unknown;
  };
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
      for (const key of ['download_url', 'downloadUrl', 'url', 'play_url']) {
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
  return {
    code: Number(body.code ?? -1),
    message: body.message || '',
    url: findUrl(body.data),
  };
}

async function getFileDownloadUrl(fid: string, cookie: string): Promise<string> {
  let result = await requestDownloadUrl(fid, cookie, config.userAgent);
  // 免费账号对大文件会返回 23018，换成桌面客户端 UA 可以拿到直链。
  if (result.code === 23018) {
    result = await requestDownloadUrl(fid, cookie, QUARK_ELECTRON_UA);
  }
  if (result.code !== 0) {
    throw new Error(quarkErrorMessage(result.code, result.message));
  }
  if (!result.url) throw new Error('夸克没有返回下载直链');
  return result.url;
}

async function findShareFileToken(
  shareId: string,
  stoken: string,
  fid: string,
  cookie: string,
): Promise<string> {
  const queue: Array<{ fid: string; depth: number }> = [{ fid: '0', depth: 0 }];
  let visited = 0;
  while (queue.length && visited < 40) {
    const current = queue.shift()!;
    visited++;
    const list = await fetchShareDetail(shareId, stoken, current.fid, cookie);
    for (const item of list) {
      if (String(item.fid || '') === fid) return String(item.share_fid_token || '');
      const isDir = Boolean(item.dir) || Number(item.file_type) === 0;
      if (isDir && current.depth < 4) {
        queue.push({ fid: String(item.fid || ''), depth: current.depth + 1 });
      }
    }
  }
  return '';
}

export async function resolveQuarkFileDownload(options: {
  shareUrl: string;
  password?: string;
  fid: string;
  shareFidToken?: string;
  name?: string;
  size?: number;
}): Promise<{ proxyUrl: string; savedFid: string; reused: boolean }> {
  const ref = parseQuarkShare(options.shareUrl, options.password);
  if (!ref) throw new Error('不是有效的夸克分享链接');
  if (!options.fid) throw new Error('缺少文件 ID');
  const cookie = getQuarkCookie();
  if (!cookie) {
    throw new Error('解析播放需要先配置夸克 Cookie');
  }
  const token = await getQuarkShareToken(ref.shareId, ref.password);
  if (!token.ok || !token.stoken) throw new Error(token.message);

  const shareFidToken =
    options.shareFidToken ||
    (await findShareFileToken(ref.shareId, token.stoken, options.fid, cookie));
  if (!shareFidToken) throw new Error('没有找到文件的分享凭证，请重新解析');

  const folderFid = await ensureSaveFolder(cookie);
  const saved = await saveShareFile(
    ref.shareId,
    token.stoken,
    {
      fid: options.fid,
      name: options.name || options.fid,
      size: Number(options.size || 0),
      shareFidToken,
    },
    folderFid,
    cookie,
  );
  const directUrl = await getFileDownloadUrl(saved.fid, cookie);
  return {
    proxyUrl: signPlayUrl(directUrl, 'https://pan.quark.cn/'),
    savedFid: saved.fid,
    reused: saved.reused,
  };
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

  // 夸克分享文件不能直接取下载直链，必须转存到自己的网盘后再取。
  // 这里只返回文件列表和分享凭证，真正播放时再按需转存单个文件。
  return {
    shareId: ref.shareId,
    files: videos,
    message: '',
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
