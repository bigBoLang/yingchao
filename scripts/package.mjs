/**
 * 把构建产物打包成可直接运行的绿色包。
 * 用法：npm run build && npm prune --omit=dev && node scripts/package.mjs
 * 产物：release/yingchao-<platform>-<arch>.tar.gz（Windows 为 .zip）
 *
 * 注意：better-sqlite3 是原生模块，必须在目标平台上构建/安装，
 * 因此不能在一台机器上交叉产出其它平台的包，需要在对应平台各跑一次。
 */
import { copyFile, cp, mkdir, rm, chmod, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const platform = process.platform;
const arch = process.arch;
const name = `yingchao-${platform}-${arch}`;
const releaseDir = path.join(root, 'release');
const stageDir = path.join(releaseDir, '.stage');
const target = path.join(stageDir, name);
const isWindows = platform === 'win32';

const required = ['dist', 'dist-server', 'node_modules', 'package.json'];
for (const entry of required) {
  await stat(path.join(root, entry)).catch(() => {
    throw new Error(`缺少 ${entry}，请先执行 npm run build`);
  });
}

await rm(stageDir, { recursive: true, force: true });
await mkdir(target, { recursive: true });

for (const entry of [...required, '.env.example', 'README.md']) {
  await cp(path.join(root, entry), path.join(target, entry), {
    recursive: true,
    dereference: true,
  });
}

// 内置 node，终端用户无需自行安装运行时
const nodeName = isWindows ? 'node.exe' : 'node';
await copyFile(process.execPath, path.join(target, nodeName));
if (!isWindows) await chmod(path.join(target, nodeName), 0o755);

if (isWindows) {
  const startCmd = [
    '@echo off',
    'cd /d "%~dp0"',
    'if not exist .env copy .env.example .env >nul',
    'node.exe -r dotenv/config dist-server/index.js',
    '',
  ].join('\r\n');
  await writeFile(path.join(target, 'start.cmd'), startCmd);
} else {
  const startSh = [
    '#!/bin/sh',
    'set -e',
    'cd "$(dirname "$0")"',
    'if [ ! -f .env ]; then',
    '  cp .env.example .env',
    '  echo "已生成 .env，请按需填写 QUARK_COOKIE / APP_SECRET"',
    'fi',
    'exec ./node -r dotenv/config dist-server/index.js',
    '',
  ].join('\n');
  const file = path.join(target, 'start.sh');
  await writeFile(file, startSh);
  await chmod(file, 0o755);
}

const archive = path.join(releaseDir, `${name}.${isWindows ? 'zip' : 'tar.gz'}`);

if (isWindows) {
  execFileSync(
    'powershell',
    ['-NoProfile', '-Command', `Compress-Archive -Path '${target}' -DestinationPath '${archive}' -Force`],
    { stdio: 'inherit' },
  );
} else {
  execFileSync('tar', ['-czf', archive, '-C', stageDir, name], { stdio: 'inherit' });
}

await rm(stageDir, { recursive: true, force: true });

const { size } = await stat(archive);
console.log(`✅ ${path.relative(root, archive)}  ${(size / 1024 / 1024).toFixed(1)} MB`);
