import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { config } from './config.js';
import { smartFetch } from './direct-fetch.js';
import { signPlayUrl } from './quark.js';
import type { QuarkFile, QuarkResolveResult, Resource } from './types.js';

const MOBILE_KEY = Buffer.from('PVGDwmcvfs1uV3d1');
const MOBILE_API = 'https://share-kd-njs.yun.139.com';
// 139 的在线播放/转码主要支持常见封装；ISO 原盘通常拿不到 presentURL。
const VIDEO_EXT = /\.(mp4|mkv|avi|mov|m4v|ts|webm|flv|wmv|m2ts)$/i;
const MOBILE_HOST = /(^|\.)(?:yun\.139\.com|caiyun\.139\.com)$/i;

export interface MobileShareRef {
  linkId: string;
  password: string;
}

interface MobileApiResponse<T = Record<string, unknown>> {
  code?: string | number;
  resultCode?: string | number;
  success?: boolean;
  desc?: string;
  message?: string;
  data?: T;
}

interface MobileFolder {
  caID?: string;
  caName?: string;
  path?: string;
}

interface MobileFile {
  coID?: string;
  coName?: string;
  coSize?: number;
  coType?: number;
  path?: string;
}

interface MobileListData {
  caLst?: MobileFolder[] | null;
  coLst?: MobileFile[] | null;
  lkName?: string;
  password?: string;
}

interface MobilePlayData {
  contentInfo?: {
    contentID?: string;
    contentName?: string;
    contentSize?: number;
    presentURL?: string;
    presentLURL?: string | null;
    presentHURL?: string | null;
  };
}

function encryptBody(data: unknown): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-128-cbc', MOBILE_KEY, iv);
  const plain = Buffer.from(JSON.stringify(data), 'utf8');
  return Buffer.concat([iv, cipher.update(plain), cipher.final()]).toString('base64');
}

function decryptBody(value: string): string {
  const raw = Buffer.from(value.replace(/\s+/g, ''), 'base64');
  if (raw.length <= 16) throw new Error('移动云盘返回了空响应');
  const decipher = crypto.createDecipheriv('aes-128-cbc', MOBILE_KEY, raw.subarray(0, 16));
  let plain = Buffer.concat([decipher.update(raw.subarray(16)), decipher.final()]);
  // 某些接口会返回 gzip 压缩后的明文。
  if (plain[0] === 0x1f && plain[1] === 0x8b) {
    plain = gunzipSync(plain);
  }
  return plain.toString('utf8');
}

async function mobileRequest<T>(
  pathname: string,
  body: Record<string, unknown>,
): Promise<T> {
  let response: Response;
  try {
    response = await smartFetch(`${MOBILE_API}${pathname}`, {
      method: 'POST',
      headers: {
        'User-Agent': config.userAgent,
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json;charset=UTF-8',
        'X-Deviceinfo':
          '||9|12.27.0|chrome|131.0.0.0||macOS||zh-CN|||',
        'hcy-cool-flag': '1',
        'CMS-DEVICE': 'default',
        'x-m4c-caller': 'PC',
        'X-Yun-Api-Version': 'v1',
        Origin: 'https://yun.139.com',
        Referer: 'https://yun.139.com/',
      },
      body: encryptBody(body),
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    throw new Error(
      `移动云盘接口连接失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`移动云盘返回 HTTP ${response.status}`);
  }

  let parsed: MobileApiResponse<T> & { raw?: string };
  try {
    parsed = JSON.parse(text) as MobileApiResponse<T>;
  } catch {
    try {
      const decrypted = decryptBody(text);
      parsed = JSON.parse(decrypted) as MobileApiResponse<T>;
    } catch {
      throw new Error(`移动云盘返回了无法解析的数据：${text.slice(0, 120)}`);
    }
  }

  const code = parsed.code ?? parsed.resultCode ?? (parsed.success ? '0' : '');
  if (String(code) !== '0' || parsed.success === false) {
    throw new Error(mobileErrorMessage(parsed));
  }
  if (!parsed.data) throw new Error('移动云盘没有返回分享数据');
  return parsed.data;
}

function mobileErrorMessage(body: {
  desc?: string;
  message?: string;
  code?: string | number;
  resultCode?: string | number;
}): string {
  const desc = String(body.desc || body.message || '').trim();
  const code = String(body.code ?? body.resultCode ?? '');
  if (desc) {
    if (/密码|提取码|passwd|password/i.test(desc)) return '分享提取码不正确或需要提取码';
    if (/不存在|失效|删除|过期|取消/.test(desc)) return `移动云盘分享已失效：${desc}`;
    return `移动云盘返回错误：${desc}`;
  }
  return `移动云盘返回错误码 ${code || '未知'}`;
}

export function parseMobileShare(url: string, password = ''): MobileShareRef | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!MOBILE_HOST.test(parsed.hostname)) return null;

  // 支持：
  // https://yun.139.com/shareweb/#/w/i/<id>
  // https://yun.139.com/sharewap/#/m/i?<id>
  // https://caiyun.139.com/w/i/<id>
  // https://caiyun.139.com/m/i?<id>
  const raw = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  const patterns = [
    /\/shareweb\/#\/w\/i\/([A-Za-z0-9_-]+)/,
    /\/sharewap\/#\/m\/i\??([A-Za-z0-9_-]+)/,
    /\/w\/i\/([A-Za-z0-9_-]+)/,
    /\/m\/i\??([A-Za-z0-9_-]+)/,
  ];
  let linkId = '';
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) {
      linkId = match[1];
      break;
    }
  }
  if (!linkId) return null;

  return {
    linkId,
    password:
      password ||
      parsed.searchParams.get('pwd') ||
      parsed.searchParams.get('password') ||
      parsed.searchParams.get('passcode') ||
      '',
  };
}

async function listMobileFolder(
  ref: MobileShareRef,
  folderId: string,
): Promise<MobileListData> {
  return mobileRequest<MobileListData>(
    '/yun-share/richlifeApp/devapp/IOutLink/getOutLinkInfoV6',
    {
      getOutLinkInfoReq: {
        account: '',
        linkID: ref.linkId,
        pCaID: folderId,
        ...(ref.password ? { passwd: ref.password } : {}),
      },
    },
  );
}

export async function resolveMobileShare(
  url: string,
  password = '',
): Promise<QuarkResolveResult> {
  const ref = parseMobileShare(url, password);
  if (!ref) throw new Error('不是有效的移动云盘分享链接');

  const root = await listMobileFolder(ref, 'root');
  const files: QuarkFile[] = [];
  const queue: Array<{ id: string; path: string; depth: number }> = [];
  const seenFolders = new Set<string>();

  const collect = (folder: MobileListData, basePath: string) => {
    for (const item of folder.coLst || []) {
      const name = item.coName || '未命名文件';
      const path = basePath ? `${basePath}/${name}` : name;
      files.push({
        fid: String(item.coID || ''),
        name,
        size: Number(item.coSize || 0),
        isDir: false,
        path,
      });
    }
    for (const item of folder.caLst || []) {
      const id = String(item.caID || '');
      if (!id || seenFolders.has(id)) continue;
      seenFolders.add(id);
      const name = item.caName || '未命名文件夹';
      queue.push({
        id,
        path: basePath ? `${basePath}/${name}` : name,
        depth: 1,
      });
    }
  };

  collect(root, '');
  let visited = 0;
  while (queue.length && visited < 60 && files.length < 300) {
    const current = queue.shift()!;
    if (current.depth > 4) continue;
    const folder = await listMobileFolder(ref, current.id);
    visited++;
    for (const item of folder.coLst || []) {
      const name = item.coName || '未命名文件';
      files.push({
        fid: String(item.coID || ''),
        name,
        size: Number(item.coSize || 0),
        isDir: false,
        path: `${current.path}/${name}`,
      });
    }
    for (const item of folder.caLst || []) {
      const id = String(item.caID || '');
      if (!id || seenFolders.has(id)) continue;
      seenFolders.add(id);
      const name = item.caName || '未命名文件夹';
      queue.push({
        id,
        path: `${current.path}/${name}`,
        depth: current.depth + 1,
      });
    }
  }

  const videos = files
    .filter((file) => VIDEO_EXT.test(file.name))
    .filter((file) => file.fid)
    .slice(0, 80);

  if (!videos.length) {
    return {
      shareId: ref.linkId,
      files: [],
      message: files.length
        ? '没有识别到可在线播放的视频文件（移动云盘通常不支持 ISO 原盘预览）'
        : '分享目录为空',
    };
  }

  return {
    shareId: ref.linkId,
    files: videos,
    message: '',
  };
}

export async function resolveMobileFilePlay(options: {
  shareUrl: string;
  password?: string;
  fid: string;
}): Promise<{ proxyUrl: string; directUrl: string; format: 'hls' | 'video' }> {
  const ref = parseMobileShare(options.shareUrl, options.password);
  if (!ref) throw new Error('不是有效的移动云盘分享链接');
  const contentId = String(options.fid || '').split('/').filter(Boolean).pop();
  if (!contentId) throw new Error('缺少移动云盘文件 ID');

  const data = await mobileRequest<MobilePlayData>(
    '/yun-share/richlifeApp/devapp/IOutLink/getContentInfoFromOutLink',
    {
      getContentInfoFromOutLinkReq: {
        contentId,
        linkID: ref.linkId,
        account: '',
        ...(ref.password ? { passwd: ref.password } : {}),
      },
    },
  );

  const info = data.contentInfo;
  const directUrl = info?.presentURL || info?.presentHURL || info?.presentLURL || '';
  if (!directUrl) throw new Error('移动云盘没有返回可播放地址');
  const isHls =
    /\.m3u8(\?|$)/i.test(directUrl) || /\/hls\//i.test(directUrl);

  return {
    directUrl,
    proxyUrl: signPlayUrl(directUrl, 'https://yun.139.com/'),
    format: isHls ? 'hls' : 'video',
  };
}

export async function inspectMobileShare(
  url: string,
  password = '',
): Promise<{ status: Resource['status']; code: string; message: string }> {
  const ref = parseMobileShare(url, password);
  if (!ref) return { status: 'invalid', code: 'format', message: '不是有效的移动云盘分享链接' };
  try {
    const root = await listMobileFolder(ref, 'root');
    if (!root) return { status: 'invalid', code: 'empty', message: '分享不存在或已失效' };
    return { status: 'valid', code: '0', message: root.lkName || '分享可访问' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/提取码|密码/.test(message)) {
      return { status: 'locked', code: 'password', message };
    }
    if (/失效|不存在|删除|过期/.test(message)) {
      return { status: 'invalid', code: 'expired', message };
    }
    return { status: 'unknown', code: 'network', message };
  }
}
