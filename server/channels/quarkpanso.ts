import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import type { Channel, CloudType, NormalizedLink, SearchQuery } from '../types.js';
import { smartFetch } from '../direct-fetch.js';
import {
  cleanHtml,
  detectCloudType,
  firstString,
  normalizeCloudType,
  normalizeLink,
  titleMatchScore,
  urlKeyFor,
} from './shared.js';
import { QUARKPANSO_WASM_GZIP_BASE64 } from './quarkpanso-wasm.js';

// QuarkPanSo 的搜索接口要求 X-Sign / Is-Automated。
// 这两个值由其公开网页里的 WASM 模块生成；这里复用同一模块计算签名，
// 不绕过登录或付费限制，只用于请求公开搜索结果。
const SIGN_KEY = 'imufather';
const API_PATH = '/v1/search/disk';
const DEFAULT_SIZE = 15;
// 公共接口对同一出口 IP 有较明显的频控，默认 60 秒内只请求一次。
const DEFAULT_MIN_INTERVAL_MS = 60_000;

const DISK_TYPE_MAP: Record<string, CloudType> = {
  quark: 'quark',
  baidu: 'baidu',
  aliyun: 'aliyun',
  alipan: 'aliyun',
  uc: 'uc',
  xunlei: 'xunlei',
  '115': '115',
  '123': '123',
  tianyi: 'tianyi',
  mobile: 'mobile',
  yidong: 'mobile',
  pikpak: 'pikpak',
  guangya: 'guangya',
};

interface WasmExports {
  memory: WebAssembly.Memory;
  __wbindgen_malloc(size: number, align: number): number;
  __wbindgen_realloc(ptr: number, oldSize: number, newSize: number, align: number): number;
  __wbindgen_free(ptr: number, len: number, align: number): void;
  __wbindgen_export_2: WebAssembly.Table;
  __wbindgen_start(): void;
  gen_sign(aPtr: number, aLen: number, bPtr: number, bLen: number): ArrayLike<number>;
  gen_automated(aPtr: number, aLen: number, bPtr: number, bLen: number): ArrayLike<number>;
}

interface Signer {
  sign(input: string): string;
  automated: string;
}

let signer: Signer | null = null;
let lastRequestAt = 0;

function writeString(
  exports: WasmExports,
  encoder: TextEncoder,
  value: string,
): { ptr: number; len: number } {
  const bytes = encoder.encode(value);
  const ptr = exports.__wbindgen_malloc(bytes.length, 1) >>> 0;
  new Uint8Array(exports.memory.buffer).subarray(ptr, ptr + bytes.length).set(bytes);
  return { ptr, len: bytes.length };
}

function createSigner(): Signer {
  const bytes = gunzipSync(Buffer.from(QUARKPANSO_WASM_GZIP_BASE64, 'base64'));
  const module = new WebAssembly.Module(bytes);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let exports: WasmExports | null = null;

  const readString = (ptr: number, len: number): string => {
    const memory = new Uint8Array(exports!.memory.buffer);
    return decoder.decode(memory.subarray(ptr, ptr + len));
  };
  const callPair = (fn: WasmExports['gen_sign'], a: string, b: string): string => {
    const aa = writeString(exports!, encoder, a);
    const bb = writeString(exports!, encoder, b);
    const result = fn(aa.ptr, aa.len, bb.ptr, bb.len);
    const ptr = Number(result[0]);
    const len = Number(result[1]);
    const value = readString(ptr, len);
    try {
      exports!.__wbindgen_free(ptr, len, 1);
    } catch {
      // ignore
    }
    return value;
  };

  const specialImports: Record<string, (...args: unknown[]) => unknown> = {
    __wbindgen_init_externref_table() {
      const table = exports!.__wbindgen_export_2;
      const n = table.grow(4);
      table.set(0, undefined);
      table.set(n, undefined);
      table.set(n + 1, null);
      table.set(n + 2, true);
      table.set(n + 3, false);
    },
    __wbindgen_string_new(ptr, len) {
      return readString(Number(ptr), Number(len));
    },
    __wbindgen_is_undefined(value) {
      return value === undefined;
    },
    __wbindgen_number_get() {
      return 0;
    },
    __wbindgen_debug_string() {
      return 0;
    },
    __wbindgen_throw(ptr, len) {
      throw new Error(readString(Number(ptr), Number(len)));
    },
    __wbg_instanceof_Window_def73ea0955fc569() {
      return true;
    },
    __wbg_onLine_dd34eaeb7b810a04() {
      return true;
    },
    __wbg_width_679079836447b4b7() {
      return 1920;
    },
    __wbg_height_614ba187d8cae9ca() {
      return 1080;
    },
    __wbg_innerWidth_7e0498dbd876d498() {
      return 1920;
    },
    __wbg_innerHeight_05f4225d754a7929() {
      return 1080;
    },
    __wbg_has_a5ea9117f258a0ec() {
      return false;
    },
  };
  const wbg = new Proxy(specialImports, {
    get(target, property) {
      if (typeof property === 'string' && property in target) return target[property];
      return () => 0;
    },
  });

  const instance = new WebAssembly.Instance(module, { wbg });
  exports = instance.exports as unknown as WasmExports;
  exports.__wbindgen_start();

  const fingerprint = {
    isAutomated: false,
    confidence: 0,
    detectedFeatures: [],
    browserInfo: {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      vendor: 'Google Inc.',
      platform: 'MacIntel',
    },
  };
  const automated = callPair(
    exports.gen_automated,
    JSON.stringify(fingerprint),
    SIGN_KEY,
  );

  return {
    sign: (input: string) => callPair(exports!.gen_sign, input, SIGN_KEY),
    automated,
  };
}

function getSigner(): Signer {
  if (!signer) signer = createSigner();
  return signer;
}

function numberConfig(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export async function searchQuarkPanSo(
  query: SearchQuery,
  channel: Channel,
  signal: AbortSignal,
  options: { force?: boolean } = {},
): Promise<NormalizedLink[]> {
  const baseUrl = (channel.baseUrl || 'https://www.quarkpanso.com').replace(/\/$/, '');
  const cfg = channel.config as {
    size?: number;
    minIntervalMs?: number;
    timeoutMs?: number;
  };
  const minInterval = numberConfig(cfg.minIntervalMs, DEFAULT_MIN_INTERVAL_MS);
  const now = Date.now();
  if (!options.force && now - lastRequestAt < minInterval) {
    // 频控期间安静跳过，避免拖慢其它渠道。
    return [];
  }
  lastRequestAt = now;

  const size = Math.max(1, Math.min(50, numberConfig(cfg.size, DEFAULT_SIZE)));
  const body = JSON.stringify({
    page: 1,
    q: query.title,
    user: '',
    exact: false,
    format: [],
    share_time: '',
    size,
    order: '',
    type: '',
    search_ticket: '',
    exclude_user: [],
    adv_params: {
      wechat_pwd: '',
      search_code: '',
      platform: 'pc',
      fp_data: crypto.randomBytes(16).toString('hex'),
      automated: '0',
    },
  });
  const time = String(Date.now());
  const currentSigner = getSigner();
  const sign = currentSigner.sign(`${API_PATH}##${time}##${body}`);
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Origin: baseUrl,
    Referer: `${baseUrl}/`,
    'X-Path': API_PATH,
    'X-Time': time,
    'X-Sign': sign,
    'X-Request-ID': crypto.randomUUID(),
    'Is-Automated': currentSigner.automated,
  };
  const timeoutMs = Math.max(5000, numberConfig(cfg.timeoutMs, 15000));
  const response = await smartFetch(`${baseUrl}${API_PATH}`, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
  });
  const text = await response.text();
  let payload: {
    code?: number;
    msg?: string;
    data?: {
      list?: Array<Record<string, unknown>>;
      total?: number;
    };
  };
  try {
    payload = JSON.parse(text) as typeof payload;
  } catch {
    throw new Error(`QuarkPanSo 返回了非 JSON 响应（HTTP ${response.status}）`);
  }
  if (!response.ok || payload.code !== 200) {
    const code = payload.code ?? response.status;
    const message = payload.msg || `HTTP ${response.status}`;
    if (code === 412) {
      // 正常搜索时安静跳过：公共接口限流不值得让整个聚合搜索报错。
      if (!options.force) return [];
      throw new Error('QuarkPanSo 公共接口限流，请稍后再试');
    }
    if (code === 418) {
      throw new Error('QuarkPanSo 签名校验失败，站点可能已更新');
    }
    throw new Error(`QuarkPanSo 错误 ${code}：${message}`);
  }

  const list = Array.isArray(payload.data?.list) ? payload.data!.list! : [];
  const links: NormalizedLink[] = [];
  for (const item of list) {
    const url = firstString(item.link, item.url, item.share_url);
    if (!url) continue;
    const rawCloud = firstString(item.disk_type).toLowerCase();
    const detected = detectCloudType(url);
    const cloudType =
      detected !== 'other'
        ? detected
        : DISK_TYPE_MAP[rawCloud] || normalizeCloudType(rawCloud);
    const title =
      cleanHtml(firstString(item.disk_name, item.title, item.files)) || query.title;
    const files = cleanHtml(firstString(item.files)).replace(/\s*\n\s*/g, ' / ');
    const normalized = normalizeLink({
      title,
      url,
      password: firstString(item.disk_pass, item.password),
      cloudType,
      note: files.slice(0, 300),
      datetime: firstString(item.shared_time, item.datetime),
      channelId: channel.id,
      channelName: channel.name,
      raw: {
        ...item,
        matchScore: titleMatchScore(query.title, title),
      },
    });
    if (normalized) links.push(normalized);
  }

  const seen = new Set<string>();
  return links
    .filter((link) => {
      if (query.cloudType && query.cloudType !== 'all' && link.cloudType !== query.cloudType) {
        return false;
      }
      const key = urlKeyFor(link.url, link.password);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, query.maxResults || 30);
}

export async function testQuarkPanSo(channel: Channel): Promise<{
  count: number;
  ms: number;
  message?: string;
}> {
  const started = Date.now();
  const links = await searchQuarkPanSo(
    { title: '流浪地球', cloudType: 'quark', maxResults: 10 },
    {
      ...channel,
      config: { ...channel.config, size: 10, minIntervalMs: 0 },
    },
    new AbortController().signal,
    { force: true },
  );
  return {
    count: links.length,
    ms: Date.now() - started,
    message: links.length
      ? '连接正常'
      : '可访问，但没有返回结果（公共接口可能正在限流）',
  };
}
