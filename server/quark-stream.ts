import { Readable } from 'node:stream';
import { quarkFetch as fetch } from './direct-fetch.js';

// 夸克直链对单连接有明显限速。浏览器播放时通常只发一个大 Range 请求，
// 这里把一个 Range 拆成多个小块并发拉取，再按顺序喂给播放器。
// 这样不会改变播放器看到的内容，但能利用会员账号的多连接带宽。
// 分片太大时播放器要等整块下完才有数据，8MB 实测会出现约 3.8 秒空档；
// 2MB 能把间隔压到 1.5 秒左右，吞吐基本不变，内存占用也更低。
const DEFAULT_CHUNK_SIZE = 2 * 1024 * 1024;
const DEFAULT_CONCURRENCY = 4;
// 实测并发 4~6 路最合适，8 路以上收益下降甚至更慢；
// 播放时在 4~8 之间按实际吞吐动态调整。
const MIN_CONCURRENCY = 4;
const MAX_CONCURRENCY = 8;
const INITIAL_CONCURRENCY = 6;
const ADAPT_INTERVAL_MS = 3000;
const CHUNK_TIMEOUT_MS = 120000;
// 首块只用 512KB：原来要等整块 8MB 下完才回数据，起播会卡好几秒。
const FIRST_CHUNK_SIZE = 512 * 1024;

export interface QuarkRangeStream {
  status: number;
  headers: Record<string, string>;
  stream: Readable;
  cancel: () => void;
}

interface OpenQuarkRangeStreamOptions {
  url: string;
  headers: Record<string, string>;
  range?: string;
  signal: AbortSignal;
  chunkSize?: number;
  // 固定并发数；不传或 adaptive 为 true 时在 4~8 之间动态调整。
  concurrency?: number;
  adaptive?: boolean;
  // 每从上游收到一块数据就回调字节数，用于实时网速统计。
  onBytes?: (bytes: number) => void;
  // 当前实际并发数变化时回调，用于前端展示。
  onConcurrency?: (value: number) => void;
}

interface ParsedRange {
  start: number;
  end?: number;
}

function parseRange(range?: string): ParsedRange | null {
  if (!range) return { start: 0 };
  // 多段 Range 很少见，交给原来的单流路径处理。
  const match = /^bytes=(\d+)-(\d*)$/i.exec(range.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : undefined;
  if (!Number.isSafeInteger(start) || start < 0) return null;
  if (end != null && (!Number.isSafeInteger(end) || end < start)) return null;
  return { start, end };
}

function parseTotal(contentRange: string | null): number | null {
  const match = /\/(\d+)\s*$/.exec(contentRange || '');
  if (!match) return null;
  const total = Number(match[1]);
  return Number.isSafeInteger(total) && total > 0 ? total : null;
}

export async function openQuarkRangeStream(
  options: OpenQuarkRangeStreamOptions,
): Promise<QuarkRangeStream | null> {
  const parsed = parseRange(options.range);
  if (!parsed) return null;

  const chunkSize = Math.max(1, options.chunkSize || DEFAULT_CHUNK_SIZE);
  // 默认自适应；显式 adaptive=false 时用固定并发（压测用）。
  const fixedConcurrency = options.adaptive === false;
  let limit = fixedConcurrency
    ? Math.max(2, options.concurrency || DEFAULT_CONCURRENCY)
    : Math.min(
        Math.max(options.concurrency || INITIAL_CONCURRENCY, MIN_CONCURRENCY),
        MAX_CONCURRENCY,
      );
  const firstSize = Math.min(chunkSize, FIRST_CHUNK_SIZE);
  // 小于首块的 Range 直接走单流，避免为几百 KB 数据额外建连。
  if (parsed.end != null && parsed.end - parsed.start + 1 < firstSize) return null;
  options.onConcurrency?.(limit);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal.addEventListener('abort', onAbort, { once: true });

  const cleanup = () => {
    options.signal.removeEventListener('abort', onAbort);
  };

  async function fetchChunk(start: number, end: number): Promise<Response> {
    const response = await fetch(options.url, {
      headers: {
        ...options.headers,
        Range: `bytes=${start}-${end}`,
        // 避免 CDN 对视频做压缩后导致 Range 长度对不上。
        'Accept-Encoding': 'identity',
      },
      redirect: 'follow',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(CHUNK_TIMEOUT_MS)]),
    });
    if (response.status !== 206) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`上游不支持分段拉流（HTTP ${response.status}）`);
    }
    return response;
  }

  async function readBody(response: Response, expected: number): Promise<Buffer> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('上游没有返回数据流');
    const parts: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      parts.push(value);
      received += value.length;
      // 按实际到达的字节回调，这样并发分片下网速统计也是连续的。
      options.onBytes?.(value.length);
    }
    if (received !== expected) throw new Error('上游分段数据不完整');
    return Buffer.concat(parts, received);
  }

  try {
    const firstStart = parsed.start;
    const firstEnd = Math.min(
      parsed.end ?? firstStart + firstSize - 1,
      firstStart + firstSize - 1,
    );
    const firstResponse = await fetchChunk(firstStart, firstEnd);
    const total = parseTotal(firstResponse.headers.get('content-range'));
    if (!total || firstStart >= total) {
      await firstResponse.body?.cancel().catch(() => {});
      cleanup();
      controller.abort();
      return null;
    }

    const end = Math.min(parsed.end ?? total - 1, total - 1);
    const firstExpected = Math.min(firstSize, end - firstStart + 1);
    let firstBuffer: Buffer;
    try {
      firstBuffer = await readBody(firstResponse, firstExpected);
    } catch {
      cleanup();
      controller.abort();
      return null;
    }

    const status = options.range ? 206 : 200;
    const contentLength = end - firstStart + 1;
    const contentType =
      firstResponse.headers.get('content-type') || 'application/octet-stream';
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Length': String(contentLength),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    };
    if (status === 206) {
      headers['Content-Range'] = `bytes ${firstStart}-${end}/${total}`;
    }

    const pending = new Map<number, Promise<Buffer>>();
    let nextStart = firstStart + firstExpected;
    // 采样窗口内失败的分片数，用于触发降并发。
    let failedChunks = 0;

    const schedule = (start: number) => {
      const chunkEnd = Math.min(start + chunkSize - 1, end);
      const expected = chunkEnd - start + 1;
      // CDN 偶发断流会让整条播放中断；单块失败时重试一次，尽量不打断播放。
      const fetchWithRetry = async (): Promise<Buffer> => {
        let lastError: unknown;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const response = await fetchChunk(start, chunkEnd);
            return await readBody(response, expected);
          } catch (error) {
            lastError = error;
            failedChunks += 1;
            if (controller.signal.aborted) break;
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        }
        throw lastError;
      };
      const promise = fetchWithRetry();
      // 预取分片可能先于当前分片失败；先挂一个空 catch，避免
      // Node 把它当成未处理的 Promise rejection。真正消费时仍会抛出。
      promise.catch(() => {});
      pending.set(start, promise);
    };

    // 工作槽位 = 正在消费的 1 块 + 预取的分片；按当前 limit 补齐。
    const fill = () => {
      while (nextStart <= end && pending.size < Math.max(1, limit - 1)) {
        schedule(nextStart);
        nextStart += chunkSize;
      }
    };

    fill();

    async function* chunks(): AsyncGenerator<Buffer> {
      let position = firstStart;
      let consumed = 0;
      let sampleBytes = 0;
      let sampleAt = Date.now();
      let lastSpeed = 0;

      // 根据最近窗口的实际吞吐在 4~8 路之间调整并发：提速则加一路，明显变慢或出现失败则减一路。
      const adapt = () => {
        if (fixedConcurrency) return;
        const now = Date.now();
        const elapsed = (now - sampleAt) / 1000;
        if (elapsed * 1000 < ADAPT_INTERVAL_MS) return;
        const speed = (consumed - sampleBytes) / elapsed;
        const previousLimit = limit;
        if (failedChunks > 0) {
          limit = Math.max(MIN_CONCURRENCY, limit - 1);
        } else if (lastSpeed > 0 && speed > lastSpeed * 1.2) {
          limit = Math.min(MAX_CONCURRENCY, limit + 1);
        } else if (lastSpeed > 0 && speed < lastSpeed * 0.85) {
          limit = Math.max(MIN_CONCURRENCY, limit - 1);
        }
        if (limit !== previousLimit) options.onConcurrency?.(limit);
        lastSpeed = lastSpeed > 0 ? lastSpeed * 0.4 + speed * 0.6 : speed;
        sampleBytes = consumed;
        sampleAt = now;
        failedChunks = 0;
      };

      try {
        yield firstBuffer;
        position += firstBuffer.length;
        consumed += firstBuffer.length;

        while (position <= end) {
          const promise = pending.get(position);
          if (!promise) throw new Error('缺少分段数据');
          const buffer = await promise;
          pending.delete(position);
          yield buffer;
          position += buffer.length;
          consumed += buffer.length;
          // 消费完一块后顺带做一次自适应，并补满工作槽位。
          adapt();
          fill();
        }
      } finally {
        cleanup();
        controller.abort();
        await Promise.allSettled(pending.values());
      }
    }

    return {
      status,
      headers,
      stream: Readable.from(chunks()),
      cancel: () => {
        cleanup();
        controller.abort();
      },
    };
  } catch {
    cleanup();
    controller.abort();
    return null;
  }
}
