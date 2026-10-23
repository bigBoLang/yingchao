import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { config } from './config.js';
import { isProxyReachable } from './direct-fetch.js';

// 影巢只负责元数据与播放，资源检索依赖本机的 PanSou。
// 以前 PanSou 需要单独手动启动，忘记开就会出现「渠道 fetch failed」；
// 这里在影巢启动时自动把它拉起来，退出时一起关掉。
//
// 查找顺序：
//   1. PANSOU_BIN 指定的路径
//   2. 程序目录下的 pansou/pansou（绿色包）
//   3. macOS 的 ~/Library/Application Support/yingchao/pansou/pansou
//   4. 数据目录下的 pansou/pansou
const START_WAIT_MS = 15_000;
const MAX_RESTARTS = 3;
const STABLE_RUN_MS = 60_000;

let child: ChildProcess | null = null;
let childStartedAt = 0;
let starting = false;
let stopping = false;
let restarts = 0;
let restartTimer: NodeJS.Timeout | null = null;
let managedBin = '';

function log(message: string): void {
  console.log(`[pansou] ${message}`);
}

function localEndpoint(): { host: string; port: number } | null {
  try {
    const url = new URL(config.pansouBaseUrl);
    const host = url.hostname;
    if (!['127.0.0.1', 'localhost', '::1', '0.0.0.0'].includes(host)) return null;
    return {
      host: host === '0.0.0.0' ? '127.0.0.1' : host,
      port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
    };
  } catch {
    return null;
  }
}

function portOpen(
  host: string,
  port: number,
  timeoutMs = 400,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function executable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findPansouBinary(): string | null {
  const exe = process.platform === 'win32' ? 'pansou.exe' : 'pansou';
  const candidates = [
    config.pansouBin,
    path.join(config.root, 'pansou', exe),
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'yingchao', 'pansou', exe)
      : '',
    path.join(config.dataDir, 'pansou', exe),
  ].filter(Boolean);
  return candidates.find((candidate) => executable(candidate)) || null;
}

async function waitUntilReady(host: string, port: number): Promise<boolean> {
  const deadline = Date.now() + START_WAIT_MS;
  while (Date.now() < deadline) {
    if (await portOpen(host, port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

async function spawnPansou(bin: string, host: string, port: number): Promise<void> {
  const dir = path.dirname(bin);
  const workDir = path.join(dir, 'data');
  fs.mkdirSync(workDir, { recursive: true });
  const logPath = path.join(dir, 'pansou.log');
  const logFd = fs.openSync(logPath, 'a');

  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port) };
  // 代理没开时不要给 PanSou 传失效的代理，否则它每次请求都要先失败一轮。
  if (!(await isProxyReachable())) {
    for (const key of [
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'ALL_PROXY',
      'PROXY',
      'http_proxy',
      'https_proxy',
      'all_proxy',
      'proxy',
    ]) {
      delete env[key];
    }
  }
  // 和原来的 start.sh 保持一致，只启用常用插件；用户显式配置时以用户的为准。
  // qqpd 用于腾讯 QQ 频道，需要用户先在 /qqpd/<hash> 扫码登录并配置频道。
  env.ENABLED_PLUGINS ||= 'pansearch,quarksoo,yunso,sousou,qqpd';

  try {
    const proc = spawn(bin, [], {
      cwd: workDir,
      env,
      stdio: ['ignore', logFd, logFd],
    });
    child = proc;
    childStartedAt = Date.now();
    managedBin = bin;
    proc.once('exit', (code, signal) => {
      if (child === proc) child = null;
      fs.closeSync(logFd);
      onExit(code, signal);
    });
    proc.once('error', (error) => {
      log(`启动失败：${error.message}`);
      if (child === proc) child = null;
    });
    log(`已启动（PID ${proc.pid ?? '未知'}，端口 ${port}），日志：${logPath}`);
  } catch (error) {
    fs.closeSync(logFd);
    log(`启动失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

function onExit(code: number | null, signal: NodeJS.Signals | null): void {
  const reason = signal ? `信号 ${signal}` : `退出码 ${code}`;
  if (stopping) return;
  if (Date.now() - childStartedAt > STABLE_RUN_MS) restarts = 0;
  if (restarts >= MAX_RESTARTS) {
    log(`进程已${reason}，连续退出 ${restarts} 次，停止自动重启`);
    return;
  }
  restarts += 1;
  const delay = Math.min(10_000, 1_500 * restarts);
  log(`进程已${reason}，${Math.round(delay / 1000)} 秒后尝试重启（第 ${restarts} 次）`);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    void startPansou();
  }, delay);
}

export async function startPansou(): Promise<void> {
  if (!config.pansouAutostart || stopping || starting || restartTimer) return;
  const endpoint = localEndpoint();
  if (!endpoint) return;
  if (child) return;
  if (await portOpen(endpoint.host, endpoint.port)) {
    if (!managedBin) {
      log(`端口 ${endpoint.port} 已在运行，跳过自动启动`);
    }
    return;
  }
  const bin = findPansouBinary();
  if (!bin) {
    log('未找到 PanSou 可执行文件，跳过自动启动（可用 PANSOU_BIN 指定路径）');
    return;
  }
  starting = true;
  try {
    await spawnPansou(bin, endpoint.host, endpoint.port);
  } finally {
    starting = false;
  }
  const ready = await waitUntilReady(endpoint.host, endpoint.port);
  if (ready) {
    log(`就绪：${config.pansouBaseUrl}`);
  } else {
    log(`启动后 ${START_WAIT_MS / 1000} 秒内端口仍未就绪，请查看日志`);
  }
}

export async function stopPansou(): Promise<void> {
  stopping = true;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  const proc = child;
  child = null;
  if (!proc || proc.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // ignore
      }
      resolve();
    }, 2500);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      proc.kill('SIGTERM');
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}
