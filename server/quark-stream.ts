import { Readable } from 'node:stream';

// 夸克直链对单连接有明显限速。浏览器播放时通常只发一个大 Range 请求，
// 这里把一个 Range 拆成多个小块并发拉取，再按顺序喂给播放器。
// 这样不会改变播放器看到的内容，但能利用会员账号的多连接带宽。
const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024;
const DEFAULT_CONCURRENCY = 4;
const CHUNK_TIMEOUT_MS = 120000;

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
  concurrency?: number;
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
  const concurrency = Math.max(2, options.concurrency || DEFAULT_CONCURRENCY);
  // 小于一个分片的 Range 直接走单流，避免为几 MB 数据额外建连。
  if (parsed.end != null && parsed.end - parsed.start + 1 < chunkSize) return null;
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

  try {
    const firstStart = parsed.start;
    const firstEnd = Math.min(
      parsed.end ?? firstStart + chunkSize - 1,
      firstStart + chunkSize - 1,
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
    const firstExpected = Math.min(chunkSize, end - firstStart + 1);
    const firstBuffer = Buffer.from(await firstResponse.arrayBuffer());
    if (firstBuffer.length !== firstExpected) {
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
    let nextStart = firstStart + chunkSize;

    const schedule = (start: number) => {
      const chunkEnd = Math.min(start + chunkSize - 1, end);
      const promise = fetchChunk(start, chunkEnd).then(async (response) => {
        const buffer = Buffer.from(await response.arrayBuffer());
        const expected = chunkEnd - start + 1;
        if (buffer.length !== expected) {
          throw new Error('上游分段数据不完整');
        }
        return buffer;
      });
      // 预取分片可能先于当前分片失败；先挂一个空 catch，避免
      // Node 把它当成未处理的 Promise rejection。真正消费时仍会抛出。
      promise.catch(() => {});
      pending.set(start, promise);
    };

    while (nextStart <= end && pending.size < concurrency - 1) {
      schedule(nextStart);
      nextStart += chunkSize;
    }

    async function* chunks(): AsyncGenerator<Buffer> {
      let position = firstStart;
      try {
        yield firstBuffer;
        position += firstBuffer.length;

        while (position <= end) {
          const promise = pending.get(position);
          if (!promise) throw new Error('缺少分段数据');
          const buffer = await promise;
          pending.delete(position);
          yield buffer;
          position += buffer.length;

          if (nextStart <= end) {
            schedule(nextStart);
            nextStart += chunkSize;
          }
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
