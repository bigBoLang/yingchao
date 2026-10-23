export const CLOUD_LABELS: Record<string, string> = {
  quark: '夸克网盘',
  baidu: '百度网盘',
  aliyun: '阿里云盘',
  uc: 'UC 网盘',
  xunlei: '迅雷云盘',
  '123': '123 云盘',
  '115': '115 网盘',
  tianyi: '天翼云盘',
  mobile: '移动云盘',
  pikpak: 'PikPak',
  guangya: '光鸭云盘',
  magnet: '磁力链接',
  ed2k: '电驴链接',
  other: '其他',
};

export const CLOUD_COLORS: Record<string, string> = {
  quark: '#5b8cff',
  baidu: '#4f7cff',
  aliyun: '#ff7a45',
  uc: '#41c7b5',
  xunlei: '#4f8cff',
  '123': '#3f8cff',
  '115': '#5a9bff',
  tianyi: '#4d9fff',
  mobile: '#5a9bff',
  pikpak: '#5c6bff',
  guangya: '#ff9a3c',
  magnet: '#f5b94c',
  ed2k: '#9ca3af',
  other: '#8b8f9c',
};

export const STATUS_META: Record<
  string,
  { label: string; className: string; hint: string }
> = {
  valid: { label: '有效', className: 'status-valid', hint: '链接可用' },
  locked: { label: '需提取码', className: 'status-locked', hint: '链接存在，但需要密码或登录' },
  unknown: { label: '未检测', className: 'status-unknown', hint: '尚未检测可用性' },
  invalid: { label: '已失效', className: 'status-invalid', hint: '链接已失效' },
};

export function formatDate(timestamp: number): string {
  if (!timestamp) return '—';
  const date = new Date(timestamp * 1000);
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function relativeTime(timestamp: number): string {
  if (!timestamp) return '从未';
  const diff = Math.max(0, Date.now() / 1000 - timestamp);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
  return formatDate(timestamp);
}

export function formatCount(count: number): string {
  if (count >= 10000) return `${(count / 10000).toFixed(1)} 万`;
  return String(count);
}

export function formatRating(rating: number): string {
  return rating > 0 ? rating.toFixed(1) : '暂无';
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

/** 播放速度：字节/秒 转成 MB/s 文案。 */
export function formatSpeed(bytesPerSecond: number): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return '—';
  return `${(bytesPerSecond / 1048576).toFixed(2)} MB/s`;
}

export function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0 || !Number.isFinite(seconds)) return '';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  if (minutes > 0) return `${minutes} 分钟`;
  return `${total} 秒`;
}

export function initials(title: string): string {
  return (title || '影').slice(0, 2);
}

export function typeLabel(type: string): string {
  return type === 'tv' ? '剧集' : '电影';
}
