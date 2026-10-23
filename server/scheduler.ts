import { config } from './config.js';
import {
  finishJob,
  getRuntimeSettings,
  getStats,
  getTopHotSubjects,
  listChannels,
  listHistorySubjects,
  listJobs,
  now,
  startJob,
} from './db.js';
import { refreshAllCollections } from './douban.js';
import { searchSubjectResources } from './services/search.js';
import { validateStaleResources } from './validator.js';
import { probePlaySpeed, type ProbeResult } from './speed-probe.js';

type JobName = 'collections' | 'hot-resources' | 'history-resources' | 'validate' | 'speed-probe';
const running = new Set<JobName>();

function lastFinished(name: JobName): number {
  const job = listJobs(100).find((item) => item.name === name && item.finishedAt);
  return job?.finishedAt || 0;
}

function due(name: JobName, hours: number): boolean {
  return now() - lastFinished(name) >= hours * 3600;
}

async function withJob<T>(
  name: JobName,
  fn: () => Promise<T>,
): Promise<{ skipped?: boolean; result?: T; error?: string }> {
  if (running.has(name)) return { skipped: true };
  running.add(name);
  const jobId = startJob(name);
  try {
    const result = await fn();
    const message =
      name === 'collections'
        ? '榜单缓存已刷新'
        : name === 'hot-resources'
          ? `已刷新 ${JSON.stringify(result)}`
          : `巡检完成：${JSON.stringify(result)}`;
    finishJob(jobId, 'ok', message);
    return { result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finishJob(jobId, 'error', message);
    return { error: message };
  } finally {
    running.delete(name);
  }
}

export async function runCollectionsJob(): Promise<{ skipped?: boolean; error?: string }> {
  const outcome = await withJob('collections', async () => {
    const summary: Record<string, number> = {};
    await refreshAllCollections((key, count, error) => {
      summary[key] = count;
      if (error) console.error(`[job] ${key}: ${error}`);
    });
    return summary;
  });
  return { skipped: outcome.skipped, error: outcome.error };
}

export async function runHotResourcesJob(): Promise<{
  skipped?: boolean;
  error?: string;
  refreshed?: number;
  resources?: number;
}> {
  const runtime = getRuntimeSettings();
  const channels = listChannels(true);
  const hasHealthyChannel = channels.some(
    (channel) => channel.lastOkAt && now() - channel.lastOkAt < 7 * 86400,
  );
  if (!hasHealthyChannel) {
    return {
      skipped: true,
      error: '还没有成功使用过的渠道，先完成一次手动检索后再启用热门缓存刷新',
    };
  }
  const subjects = getTopHotSubjects(Math.max(1, runtime.hotRefreshLimit));
  let refreshed = 0;
  let resources = 0;
  const outcome = await withJob('hot-resources', async () => {
    for (const subject of subjects) {
      try {
        const result = await searchSubjectResources(subject, {
          force: true,
          cloudType: 'quark',
        });
        refreshed++;
        resources += result.resources.length;
      } catch (error) {
        console.error(`[job] 刷新《${subject.title}》资源失败：`, error);
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    return { subjects: subjects.length, refreshed, resources };
  });
  return {
    skipped: outcome.skipped,
    error: outcome.error,
    refreshed,
    resources,
  };
}

export async function runHistoryResourcesJob(): Promise<{
  skipped?: boolean;
  error?: string;
  refreshed?: number;
  resources?: number;
}> {
  const channels = listChannels(true);
  const hasHealthyChannel = channels.some(
    (channel) => channel.lastOkAt && now() - channel.lastOkAt < 7 * 86400,
  );
  if (!hasHealthyChannel) {
    return {
      skipped: true,
      error: '还没有成功使用过的渠道，先完成一次手动检索后再启用播放记录缓存',
    };
  }
  const subjects = listHistorySubjects(Math.max(1, config.historyRefreshLimit));
  if (!subjects.length) return { skipped: true };

  let refreshed = 0;
  let resources = 0;
  const outcome = await withJob('history-resources', async () => {
    for (const subject of subjects) {
      try {
        const result = await searchSubjectResources(subject, {
          force: true,
          cloudType: 'quark',
        });
        refreshed++;
        resources += result.resources.length;
      } catch (error) {
        console.error(`[job] 刷新播放记录《${subject.title}》资源失败：`, error);
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    return { subjects: subjects.length, refreshed, resources };
  });
  return {
    skipped: outcome.skipped,
    error: outcome.error,
    refreshed,
    resources,
  };
}

export async function runValidateJob(): Promise<{
  skipped?: boolean;
  error?: string;
  checked?: number;
  valid?: number;
  invalid?: number;
  locked?: number;
  unknown?: number;
}> {
  const runtime = getRuntimeSettings();
  const outcome = await withJob('validate', () =>
    validateStaleResources(config.validateBatch, runtime.validateHours),
  );
  const result = outcome.result as
    | { checked: number; valid: number; invalid: number; locked: number; unknown: number }
    | undefined;
  return { skipped: outcome.skipped, error: outcome.error, ...(result || {}) };
}

export async function runSpeedProbeJob(): Promise<{
  skipped?: boolean;
  error?: string;
  avgSpeed?: number;
  peakSpeed?: number;
  reason?: string;
}> {
  const outcome = await withJob('speed-probe', () => probePlaySpeed());
  const result = outcome.result as ProbeResult | undefined;
  if (outcome.skipped) return { skipped: true };
  if (outcome.error) return { error: outcome.error };
  return {
    ...(result?.skipped ? { skipped: true } : {}),
    ...(result?.reason ? { reason: result.reason } : {}),
    ...(result?.avgSpeed != null
      ? {
          avgSpeed: Math.round(result.avgSpeed / 1024),
          peakSpeed: Math.round((result.peakSpeed || 0) / 1024),
        }
      : {}),
  };
}

export async function runJob(
  name: string,
): Promise<{ skipped?: boolean; error?: string; [key: string]: unknown }> {
  if (name === 'collections') return runCollectionsJob();
  if (name === 'hot-resources') return runHotResourcesJob();
  if (name === 'history-resources') return runHistoryResourcesJob();
  if (name === 'speed-probe') return runSpeedProbeJob();
  if (name === 'validate') return runValidateJob();
  throw new Error(`未知任务：${name}`);
}

async function tick(): Promise<void> {
  const runtime = getRuntimeSettings();
  if (!runtime.schedulerEnabled) return;

  const stats = getStats();
  if (stats.subjects === 0 || due('collections', config.collectionRefreshHours)) {
    await runCollectionsJob();
  }
  if (getStats().subjects > 0 && due('hot-resources', runtime.hotRefreshHours)) {
    await runHotResourcesJob();
  }
  if (stats.subjects > 0 && due('history-resources', runtime.historyRefreshHours)) {
    await runHistoryResourcesJob();
  }
  if (stats.resources > 0 && due('validate', runtime.validateHours)) {
    await runValidateJob();
  }
  // 速度探针不依赖数据量，只要有过播放直链缓存就会真的拉几秒测速。
  if (due('speed-probe', runtime.speedProbeHours)) {
    await runSpeedProbeJob();
  }
}

let interval: NodeJS.Timeout | null = null;

export function startScheduler(): void {
  if (interval) return;
  const runtime = getRuntimeSettings();
  if (!runtime.schedulerEnabled) {
    console.log('[scheduler] 已禁用（SCHEDULER_ENABLED=false）');
    return;
  }
  setTimeout(() => {
    tick().catch((error) => console.error('[scheduler] tick failed:', error));
  }, 5000);
  interval = setInterval(() => {
    tick().catch((error) => console.error('[scheduler] tick failed:', error));
  }, 5 * 60 * 1000);
  console.log('[scheduler] 已启动：榜单/热门资源/链接巡检/播放记录缓存/速度探针');
}

export function stopScheduler(): void {
  if (interval) clearInterval(interval);
  interval = null;
}
