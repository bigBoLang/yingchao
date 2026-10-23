import { quarkFetch as fetch } from './direct-fetch.js';
import { config } from './config.js';
import { saveSpeedSample } from './db.js';

// 定时速度探针：从已缓存的播放直链里挑一条，用和播放完全相同的
// 「2MB 分片 + 多路并发」方式拉几秒，把实测速度写库。
// 这样就能按天/时段对比，判断掉速是账号限流、CDN 节点还是运营商。
const CHUNK_SIZE = 2 * 1024 * 1024;
const CONCURRENCY = 6;
const PROBE_SECONDS = 6;

export interface ProbeTarget {
  url: string;
  referer: string;
  line: string;
  host: string;
  fileName: string;
}

export interface ProbeResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  avgSpeed?: number;
  peakSpeed?: number;
  bytes?: number;
  seconds?: number;
  host?: string;
  line?: string;
}

async function pullChunk(target: ProbeTarget, start: number, end: number, signal: AbortSignal) {
  const started = Date.now();
  let bytes = 0;
  try {
    const response = await fetch(target.url, {
      headers: {
        Range: `bytes=${start}-${end}`,
        Referer: target.referer || 'https://pan.quark.cn/',
        'User-Agent': config.userAgent,
        'Accept-Encoding': 'identity',
      },
      signal,
    });
    if (!response.body) return { bytes, speed: 0 };
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
    }
  } catch {
    // 到时间被 abort 属于预期
  }
  const seconds = Math.max(0.001, (Date.now() - started) / 1000);
  return { bytes, speed: bytes / seconds };
}

export async function probePlaySpeed(limit = CONCURRENCY): Promise<ProbeResult> {
  const target = pickProbeTarget();
  if (!target) {
    return { ok: false, skipped: true, reason: '还没有可用的播放缓存直链，先播放一次再说' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_SECONDS * 1000);
  const started = Date.now();
  try {
    const parts = await Promise.all(
      Array.from({ length: limit }, (_, index) => {
        const start = index * CHUNK_SIZE * 4;
        return pullChunk(target, start, start + CHUNK_SIZE - 1, controller.signal);
      }),
    );
    const seconds = Math.max(0.1, (Date.now() - started) / 1000);
    const bytes = parts.reduce((sum, part) => sum + part.bytes, 0);
    const peak = parts.reduce((max, part) => Math.max(max, part.speed), 0) * limit;
    if (bytes <= 0) {
      return { ok: false, reason: '探针没有拉到数据（直链可能已过期）' };
    }
    const avgSpeed = bytes / seconds;
    saveSpeedSample({
      source: 'probe',
      title: target.fileName,
      fileName: target.fileName,
      line: target.line,
      host: target.host,
      avgSpeed,
      peakSpeed: peak,
      bytes,
      seconds,
    });
    return {
      ok: true,
      avgSpeed,
      peakSpeed: peak,
      bytes,
      seconds,
      host: target.host,
      line: target.line,
    };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/** 由 quark.ts 注入：读取仍在有效的原画直链缓存。 */
let targetProvider: (() => ProbeTarget | null) | null = null;

export function registerProbeTargetProvider(provider: () => ProbeTarget | null): void {
  targetProvider = provider;
}

function pickProbeTarget(): ProbeTarget | null {
  return targetProvider ? targetProvider() : null;
}
