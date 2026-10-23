import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  FolderOpen,
  Loader2,
  MonitorPlay,
  Play,
  Server,
  Smartphone,
  Terminal,
  Download,
  AlertCircle,
  Zap,
  Gauge,
} from 'lucide-react';
import type { QuarkFile, Resource } from '../types';
import { api, absoluteUrl, playAbsoluteUrl, copyText } from '../api';
import { Modal } from './Modal';
import { useToast } from './Toast';
import { VideoPlayer } from './VideoPlayer';
import { formatBytes } from '../lib/format';

function detectPlatform() {
  if (typeof navigator === 'undefined') {
    return { ios: false, mac: false, win: false, android: false };
  }
  const ua = navigator.userAgent;
  return {
    ios: /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    android: /Android/.test(ua),
    mac: /Macintosh/.test(ua),
    win: /Windows/.test(ua),
  };
}

const PLAYER_DOWNLOADS: Record<string, { name: string; url: string; desc: string }> = {
  iina: { name: 'IINA', url: 'https://iina.io/', desc: 'macOS 现代播放器，支持 MKV/H.265/4K' },
  vlc: { name: 'VLC', url: 'https://www.videolan.org/vlc/', desc: '跨平台开源播放器，格式支持全' },
  potplayer: { name: 'PotPlayer', url: 'https://potplayer.daum.net/', desc: 'Windows 强大播放器，硬解性能好' },
  mpv: { name: 'MPV', url: 'https://mpv.io/installation/', desc: '极简命令行播放器，需配合脚本' },
  infuse: { name: 'Infuse', url: 'https://firecore.com/infuse', desc: 'iOS/macOS 顶级播放器，云同步元数据' },
  nplayer: { name: 'nPlayer', url: 'https://nplayer.tv/', desc: 'iOS 付费播放器，格式支持极全' },
  // Android
  mxplayer: { name: 'MX Player', url: 'https://mxplayer.in/', desc: 'Android 老牌硬解播放器，支持 DTS/AC3' },
  vlcAndroid: { name: 'VLC for Android', url: 'https://www.videolan.org/vlc/download-android.html', desc: 'Android 版 VLC，开源免费' },
  kmplayer: { name: 'KMPlayer', url: 'https://kmplayer.com/', desc: 'Android 多格式播放器，支持云播' },
};

type PlayerKey = keyof typeof PLAYER_DOWNLOADS;

/** 可作为「默认播放器」的选项；browser 表示留在页面内播放。 */
const DEFAULT_PLAYER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'browser', label: '浏览器（页面内播放）' },
  { value: 'iina', label: 'IINA（macOS）' },
  { value: 'vlc', label: 'VLC' },
  { value: 'potplayer', label: 'PotPlayer（Windows）' },
  { value: 'infuse', label: 'Infuse（iOS/macOS）' },
  { value: 'vlcIos', label: 'VLC iOS' },
  { value: 'nplayer', label: 'nPlayer（iOS）' },
  { value: 'mxplayer', label: 'MX Player（Android）' },
  { value: 'vlcAndroid', label: 'VLC Android' },
  { value: 'kmplayer', label: 'KMPlayer（Android）' },
  { value: 'mpv', label: 'MPV（复制命令）' },
];

function isExternalPlayer(value: string): value is PlayerKey {
  return value !== 'browser' && value in PLAYER_DOWNLOADS;
}

function tryOpenProtocol(url: string, fallbackUrl: string, playerKey: PlayerKey): void {
  // 尝试打开协议
  const link = document.createElement('a');
  link.href = url;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // 1.5 秒后检查是否跳转成功（页面可见性变化或 focus 丢失）
  const timer = window.setTimeout(() => {
    // 如果协议没唤起应用，浏览器通常会停在当前页，弹一个下载提示
    if (confirm(`${PLAYER_DOWNLOADS[playerKey].name} 似乎未安装或未响应，是否前往下载页面？`)) {
      window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
    }
  }, 1500);

  // 如果页面失去焦点（应用被唤起），清除定时器
  const onBlur = () => {
    window.clearTimeout(timer);
    window.removeEventListener('blur', onBlur);
  };
  window.addEventListener('blur', onBlur, { once: true });
}

export function PlayerModal({
  resource,
  files,
  subject,
  onClose,
}: {
  resource: Resource;
  files: QuarkFile[];
  subject?: { id: string; title: string; poster: string };
  onClose: () => void;
}) {
  const toast = useToast();
  const [selected, setSelected] = useState(0);
  const [copied, setCopied] = useState(false);
  const [playUrl, setPlayUrl] = useState('');
  const [playFormat, setPlayFormat] = useState<'hls' | 'video' | undefined>();
  const [directUrl, setDirectUrl] = useState('');
  const [directHeaders, setDirectHeaders] = useState<Record<string, string>>({});
  const [line, setLine] = useState<'proxy' | 'direct'>('proxy');
  const [quality, setQuality] = useState<'transcode' | 'original'>('original');
  const [playMeta, setPlayMeta] = useState<{
    line?: 'transcode' | 'original';
    driver?: 'tv' | 'pc';
    resolution?: string;
  } | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState('');
  const [netSpeed, setNetSpeed] = useState(0);
  const [netBytes, setNetBytes] = useState(0);
  const [netConcurrency, setNetConcurrency] = useState(0);
  const [tvReady, setTvReady] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [player, setPlayer] = useState({
    iina: true,
    vlc: true,
    potplayer: false,
    mpv: true,
    infuse: true,
    vlcIos: true,
    nplayer: true,
    mxplayer: true,
    vlcAndroid: true,
    kmplayer: true,
    defaultExternal: 'browser',
  });
  const platform = useMemo(() => detectPlatform(), []);

  // 播放记录：同一部片只保留一条，进度以最近一次播放为准。
  const saveHistory = useCallback(
    (position?: number, duration?: number) => {
      const subjectId = subject?.id || resource.subjectId;
      if (!subjectId) return;
      void api('/api/history', {
        method: 'POST',
        body: JSON.stringify({
          subjectId,
          title: subject?.title || resource.title,
          poster: subject?.poster || '',
          resourceId: resource.id,
          resourceTitle: resource.title,
          position,
          duration,
        }),
      }).catch(() => {
        // 记录失败不影响播放
      });
    },
    [subject?.id, subject?.title, subject?.poster, resource.subjectId, resource.id, resource.title],
  );

  // 拿到播放地址即记一条「看过」，即使只用外部播放器播放也能出现在历史里。
  useEffect(() => {
    if (playUrl) saveHistory();
  }, [playUrl, saveHistory]);

  useEffect(() => {
    api<{
      player: typeof player;
      quarkTv?: { loggedIn: boolean; enabled: boolean; linkMode: 'streaming' | 'download' };
    }>('/api/config')
      .then((data) => {
        setPlayer((current) => ({ ...current, ...data.player }));
        // 只有 TV 驱动可用时才展示「转码 / 原画」两条线路，否则沿用原有代理/直链。
        setTvReady(Boolean(data.quarkTv?.enabled));
        setQuality(data.quarkTv?.linkMode === 'download' ? 'original' : 'transcode');
        setConfigLoaded(true);
      })
      .catch(() => setConfigLoaded(true));
  }, []);

  const file = files[selected];
  const shareUrl = resource.url;
  const isMobile = resource.cloudType === 'mobile';
  const canPickQuality = tvReady && !isMobile && Boolean(file?.fid);
  const { ios, android, mac, win } = platform;

  useEffect(() => {
    if (!file) {
      setPlayUrl('');
      setPlayFormat(undefined);
      setDirectUrl('');
      setDirectHeaders({});
      setPlayMeta(null);
      setResolveError('');
      setResolving(false);
      return;
    }
    const localUrl = file.proxyUrl ? playAbsoluteUrl(file.proxyUrl) : file.directUrl || '';
    if (localUrl) {
      setPlayUrl(localUrl);
      setDirectUrl(file.directUrl || '');
      setDirectHeaders({});
      setPlayMeta(null);
      setPlayFormat(
        /\.m3u8(\?|$)/i.test(file.directUrl || file.proxyUrl || '') ? 'hls' : 'video',
      );
      setResolveError('');
      setResolving(false);
      return;
    }
    if (!file.fid) {
      setPlayUrl('');
      setPlayFormat(undefined);
      setDirectUrl('');
      setDirectHeaders({});
      setPlayMeta(null);
      setResolveError('没有拿到文件 ID，请重新解析资源');
      setResolving(false);
      return;
    }
    // 等 /api/config 返回后再解析，避免默认线路先按 transcode 请求一次。
    if (!configLoaded) {
      setResolving(true);
      return;
    }

    let cancelled = false;
    setPlayUrl('');
    setPlayFormat(undefined);
    setPlayMeta(null);
    setResolveError('');
    setResolving(true);
    api<{
      proxyUrl?: string;
      directUrl?: string;
      directHeaders?: Record<string, string>;
      format?: 'hls' | 'video';
      line?: 'transcode' | 'original';
      driver?: 'tv' | 'pc';
      resolution?: string;
    }>(`/api/resources/${resource.id}/play`, {
      method: 'POST',
      body: JSON.stringify({
        fid: file.fid,
        name: file.name,
        size: file.size,
        line: quality,
      }),
    })
      .then((result) => {
        if (cancelled) return;
        if (!result.proxyUrl) throw new Error('服务端没有返回播放地址');
        setPlayUrl(playAbsoluteUrl(result.proxyUrl));
        setDirectUrl(result.directUrl || '');
        setDirectHeaders(result.directHeaders || {});
        setPlayMeta({
          line: result.line,
          driver: result.driver,
          resolution: result.resolution,
        });
        setPlayFormat(
          result.format || (/\.m3u8(\?|$)/i.test(result.proxyUrl) ? 'hls' : 'video'),
        );
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setResolveError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) setResolving(false);
      });

    return () => {
      cancelled = true;
    };
  }, [file?.fid, file?.proxyUrl, file?.directUrl, resource.id, quality, configLoaded]);

  // 从代理播放地址里取 token，用于查询服务端实时流量。
  const playToken = useMemo(() => {
    if (!playUrl) return '';
    try {
      const match = new URL(playUrl).pathname.match(/^\/api\/play\/(.+)$/);
      return match ? match[1] : '';
    } catch {
      return '';
    }
  }, [playUrl]);

  useEffect(() => {
    // HLS 由多个分片 token 组成，这里只统计单文件的代理播放。
    if (!playToken || line !== 'proxy' || playFormat === 'hls') {
      setNetSpeed(0);
      setNetBytes(0);
      setNetConcurrency(0);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const stats = await api<{ bytes: number; speed: number; concurrency?: number }>(
          `/api/play-stats/${encodeURIComponent(playToken)}`,
        );
        if (cancelled) return;
        setNetSpeed(stats.speed);
        setNetBytes(stats.bytes);
        setNetConcurrency(stats.concurrency || 0);
      } catch {
        // 统计失败不影响播放
      }
    };
    void tick();
    const timer = window.setInterval(tick, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [playToken, line, playFormat]);

  const lineUrl = line === 'direct' && directUrl ? directUrl : playUrl;
  const protocols = useMemo<Record<PlayerKey, string>>(
    () => ({
      iina: lineUrl ? `iina://weblink?url=${encodeURIComponent(lineUrl)}` : '',
      // macOS VLC 用 vlc://，iOS/Android 用 x-callback-url
      vlc: lineUrl ? (ios || android ? `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(lineUrl)}` : `vlc://${lineUrl}`) : '',
      potplayer: lineUrl ? `potplayer://${lineUrl}` : '',
      infuse: lineUrl ? `infuse://x-callback-url/play?url=${encodeURIComponent(lineUrl)}` : '',
      vlcIos: lineUrl ? `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(lineUrl)}` : '',
      nplayer: lineUrl ? lineUrl.replace(/^https?:/, 'nplayer-https:').replace(/^http:/, 'nplayer-http:') : '',
      // Android players
      mxplayer: lineUrl ? `intent:${encodeURIComponent(lineUrl)}#Intent;package=com.mxtech.videoplayer.ad;scheme=https;end` : '',
      vlcAndroid: lineUrl ? `intent:${encodeURIComponent(lineUrl)}#Intent;package=org.videolan.vlc;scheme=https;end` : '',
      kmplayer: lineUrl ? `intent:${encodeURIComponent(lineUrl)}#Intent;package=com.kmplayer;scheme=https;end` : '',
    }),
    [lineUrl, ios, android],
  );

  const copy = async (value: string, message = '已复制') => {
    try {
      await copyText(value);
      setCopied(true);
      toast.push(message, 'success');
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.push('复制失败，请手动选择文本', 'error');
    }
  };

  const handlePlayerClick = useCallback((playerKey: PlayerKey, protocolUrl: string) => {
    if (!protocolUrl) return;
    const download = PLAYER_DOWNLOADS[playerKey];
    tryOpenProtocol(protocolUrl, download.url, playerKey);
  }, []);

  const headerFieldValue = Object.entries(directHeaders)
    .map(([key, value]) => `${key}: ${value}`)
    .join(',');
  const mpvCommand = directUrl
    ? headerFieldValue
      ? `mpv --http-header-fields="${headerFieldValue}" "${directUrl}"`
      : `mpv "${directUrl}"`
    : '';
  const showDirect = line === 'direct' && Boolean(directUrl);
  const defaultPlayer = player.defaultExternal || 'browser';
  // 配置了默认外部播放器时，解析完直链直接调起它，页面内不再重复拉流。
  const [forceBrowser, setForceBrowser] = useState(false);
  const autoExternal = isExternalPlayer(defaultPlayer) && !forceBrowser;

  useEffect(() => {
    setForceBrowser(false);
  }, [file?.fid]);

  // 每次拿到新的播放地址，就用「默认播放器」直接打开一次；
  // 同一个地址只自动打开一次，切换线路或换文件时才再次调起。
  const autoOpenedUrl = useRef('');
  useEffect(() => {
    // 等 /api/config 拿到真实的默认播放器后再判断，避免先用占位值误调起。
    if (!configLoaded) return;
    if (!lineUrl || showDirect) return;
    if (!isExternalPlayer(defaultPlayer)) return;
    if (autoOpenedUrl.current === lineUrl) return;
    autoOpenedUrl.current = lineUrl;

    if (defaultPlayer === 'mpv') {
      void copy(mpvCommand || `mpv "${playUrl}"`, '已复制 MPV 命令');
      return;
    }
    const protocol = protocols[defaultPlayer];
    if (protocol) handlePlayerClick(defaultPlayer, protocol);
  }, [lineUrl, showDirect, defaultPlayer, protocols, handlePlayerClick, mpvCommand, playUrl, configLoaded]);

  const saveDefaultPlayer = async (value: string) => {
    const next = { ...player, defaultExternal: value };
    setPlayer(next);
    try {
      await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ player: next }),
      });
      toast.push(
        isExternalPlayer(value)
          ? `以后点击播放将直接用 ${PLAYER_DOWNLOADS[value].name} 打开`
          : '以后点击播放将在页面内播放',
        'success',
      );
    } catch (error) {
      toast.push(error instanceof Error ? error.message : '保存默认播放器失败', 'error');
    }
  };

  return (
    <Modal
      title={file?.name || '播放资源'}
      subtitle={resource.title || resource.cloudType}
      onClose={onClose}
      wide
      footer={
        <div className="player-footer">
          <span>
            <Server size={14} />
            {showDirect ? '直链线路：流量直连网盘 CDN，不经本机代理' : '播放地址经由本机代理转发，服务关闭后将失效'}
          </span>
          {resource.password ? <span className="password-chip">提取码 {resource.password}</span> : null}
        </div>
      }
    >
      <div className="player-layout">
        <div className="player-main">
          {canPickQuality || directUrl ? (
            <div className="player-lines">
              {canPickQuality ? (
                <>
                  <button
                    type="button"
                    className={`chip ${line === 'proxy' && quality === 'original' ? 'active' : ''}`}
                    onClick={() => {
                      setQuality('original');
                      setLine('proxy');
                    }}
                  >
                    线路 A · 原画（原文件）
                  </button>
                  <button
                    type="button"
                    className={`chip ${line === 'proxy' && quality === 'transcode' ? 'active' : ''}`}
                    onClick={() => {
                      setQuality('transcode');
                      setLine('proxy');
                    }}
                  >
                    线路 B · TV 转码（起播快）
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={`chip ${line === 'proxy' ? 'active' : ''}`}
                  onClick={() => setLine('proxy')}
                >
                  线路 A · 代理（4 路并发）
                </button>
              )}
              {directUrl ? (
                <button
                  type="button"
                  className={`chip ${line === 'direct' ? 'active' : ''}`}
                  onClick={() => setLine('direct')}
                >
                  {canPickQuality ? `直链 · ${quality === 'original' ? '原画' : '转码'}` : '线路 B · 直链（不经服务器）'}
                </button>
              ) : null}
              {canPickQuality && playMeta?.line ? (
                <span className="line-hint" title={directUrl}>
                  实际线路：
                  {playMeta.line === 'original'
                    ? '原画 · 原文件'
                    : `TV 转码${playMeta.resolution ? ` · ${playMeta.resolution.toUpperCase()}` : ''}`}
                  {playMeta.driver === 'pc' ? '（PC 直链）' : '（TV 直链）'}
                </span>
              ) : null}
              {line === 'proxy' && playToken && playFormat !== 'hls' ? (
                <span
                  className="line-hint"
                  title={netBytes ? `本次已接收 ${formatBytes(netBytes)}` : undefined}
                >
                  <Gauge size={12} />
                  网速{' '}
                  {netSpeed > 0
                    ? `${(netSpeed / 1048576).toFixed(1)} MB/s · ${Math.round((netSpeed * 8) / 1e6)} Mbps`
                    : netBytes > 0
                      ? '0 MB/s'
                      : '统计中…'}
                  {netConcurrency > 0 ? ` · ${netConcurrency} 路` : ''}
                </span>
              ) : null}
            </div>
          ) : null}

          {showDirect ? (
            <div className="player-placeholder">
              <Zap size={34} />
              <p>直链线路已就绪</p>
              <span>
                流量直接走网盘 CDN，不经过影巢服务器，但只有一条连接、没有并发加速；
                浏览器和 VLC / IINA 无法携带防盗链请求头，请用下方「MPV 命令」在终端播放。
              </span>
            </div>
          ) : playUrl && autoExternal ? (
            <div className="player-placeholder">
              <ExternalLink size={34} />
              <p>
                {defaultPlayer === 'mpv'
                  ? '已复制 MPV 命令'
                  : `已用 ${PLAYER_DOWNLOADS[defaultPlayer as PlayerKey].name} 打开`}
              </p>
              <span>
                {defaultPlayer === 'mpv'
                  ? '把命令粘贴到终端即可播放；想留在页面内播放可以点下面的按钮。'
                  : '外部播放器会接管播放，页面内不再重复拉流；想留在页面内可以点下面的按钮。'}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setForceBrowser(true)}
              >
                <MonitorPlay size={15} />
                改用浏览器播放
              </button>
            </div>
          ) : playUrl ? (
            <VideoPlayer
              key={playUrl}
              src={playUrl}
              format={playFormat}
              onProgress={(position, duration) => saveHistory(position, duration)}
            />
          ) : (
            <div className="player-placeholder">
              {resolving ? <Loader2 size={34} className="spin" /> : <MonitorPlay size={34} />}
              <p>
                {resolving
                  ? isMobile
                    ? '正在获取移动云盘播放地址…'
                    : '正在转存并获取直链…'
                  : resolveError
                    ? '暂时无法播放'
                    : '没有拿到可播放直链'}
              </p>
              <span>
                {resolving
                  ? isMobile
                    ? '移动云盘会返回 HLS 流，经影巢代理后即可在浏览器播放。'
                    : '首次播放会把文件转存到你的夸克「影巢播放缓存」目录，通常需要几秒。'
                  : resolveError || '可以复制分享链接，到对应网盘 App 或网页中打开。'}
              </span>
            </div>
          )}

          <div className="player-actions">
            {showDirect ? (
              <>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(directUrl, '直链已复制')}>
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                  复制直链
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(mpvCommand, '已复制 MPV 命令')}>
                  <Terminal size={15} />
                  MPV 命令
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(headerFieldValue, '已复制请求头')}>
                  <Server size={15} />
                  复制请求头
                </button>
              </>
            ) : null}
            {lineUrl && !showDirect ? (
              <>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(lineUrl, '播放地址已复制')}>
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                  复制直链
                </button>
                {!ios && !android ? (
                  <>
                    {/* macOS 首选 IINA */}
                    {mac && player.iina ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => handlePlayerClick('iina', protocols.iina)}
                        title="macOS 推荐：IINA"
                      >
                        <ExternalLink size={15} />
                        IINA
                      </button>
                    ) : null}
                    {/* Windows 首选 PotPlayer / VLC */}
                    {win && player.potplayer ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => handlePlayerClick('potplayer', protocols.potplayer)}
                        title="Windows 推荐：PotPlayer"
                      >
                        <ExternalLink size={15} />
                        PotPlayer
                      </button>
                    ) : null}
                    {player.vlc ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => handlePlayerClick('vlc', protocols.vlc)}
                        title="跨平台：VLC (x-callback-url)"
                      >
                        <ExternalLink size={15} />
                        VLC
                      </button>
                    ) : null}
                    {mac && player.iina ? null : (
                      player.iina ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => handlePlayerClick('iina', protocols.iina)}
                        >
                          <ExternalLink size={15} />
                          IINA
                        </button>
                      ) : null
                    )}
                    {win && player.potplayer ? null : (
                      player.potplayer ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => handlePlayerClick('potplayer', protocols.potplayer)}
                        >
                          <ExternalLink size={15} />
                          PotPlayer
                        </button>
                      ) : null
                    )}
                    {player.mpv ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => copy(showDirect ? mpvCommand : `mpv "${playUrl}"`, '已复制 MPV 命令')}
                      >
                        <Terminal size={15} />
                        MPV 命令
                      </button>
                    ) : null}
                  </>
                ) : android ? (
                  <>
                    {/* Android 首选 MX Player / VLC */}
                    {player.mxplayer ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => handlePlayerClick('mxplayer', protocols.mxplayer)}
                        title="Android 推荐：MX Player"
                      >
                        <Smartphone size={15} />
                        MX Player
                      </button>
                    ) : null}
                    {player.vlcAndroid ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => handlePlayerClick('vlcAndroid', protocols.vlcAndroid)}
                        title="Android：VLC for Android"
                      >
                        <Smartphone size={15} />
                        VLC
                      </button>
                    ) : null}
                    {player.kmplayer ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => handlePlayerClick('kmplayer', protocols.kmplayer)}
                        title="Android：KMPlayer"
                      >
                        <Smartphone size={15} />
                        KMPlayer
                      </button>
                    ) : null}
                  </>
                ) : (
                  <>
                    {player.infuse ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => handlePlayerClick('infuse', protocols.infuse)}
                      >
                        <Smartphone size={15} />
                        Infuse
                      </button>
                    ) : null}
                    {player.vlcIos ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => handlePlayerClick('vlc', protocols.vlcIos)}
                      >
                        <Smartphone size={15} />
                        VLC
                      </button>
                    ) : null}
                    {player.nplayer ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => handlePlayerClick('nplayer', protocols.nplayer)}
                      >
                        <Smartphone size={15} />
                        nPlayer
                      </button>
                    ) : null}
                  </>
                )}
              </>
            ) : null}
            <a className="btn btn-ghost btn-sm" href={shareUrl} target="_blank" rel="noreferrer">
              <FolderOpen size={15} />
              打开原分享
            </a>
            {lineUrl && !showDirect ? (
              <label className="player-default-pick" title="选定后，以后点击播放会直接用这个播放器打开">
                <span>默认播放器</span>
                <select
                  value={defaultPlayer}
                  onChange={(event) => void saveDefaultPlayer(event.target.value)}
                >
                  {DEFAULT_PLAYER_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          <p className="player-tip">
            {isMobile
              ? '移动云盘分享会返回 HLS 播放列表，影巢会把播放列表和分片统一代理到本机，浏览器、IINA、VLC 都可以直接播放。'
              : '夸克分享首次播放会按需转存到你的「影巢播放缓存」目录，之后再次播放会直接复用。'}
            {ios
              ? ' iOS 首次点击会弹系统「打开 VLC/Infuse？」询问，允许后再点一次即可播放 MKV/H.265。'
              : android
                ? ' Android 首次点击会弹系统「打开 MX Player/VLC？」询问，允许后再点一次即可播放 MKV/H.265。'
                : ' 浏览器无法播放 MKV / H.265 时，请改用 IINA 或 VLC。'}
            外部播放器需要先在「设置 → 播放器」中启用。
          </p>
        </div>

        <aside className="player-files">
          <div className="player-files-head">
            <h3>文件列表</h3>
            <span>{files.length} 个</span>
          </div>
          <div className="player-file-list">
            {files.map((entry, index) => (
              <button
                type="button"
                key={`${entry.fid}-${entry.name}`}
                className={`player-file ${index === selected ? 'active' : ''}`}
                onClick={() => setSelected(index)}
              >
                <span className="player-file-icon">
                  <Play size={14} />
                </span>
                <span className="player-file-name">{entry.name}</span>
                <span className="player-file-size">
                  {entry.sizeLabel || formatBytes(entry.size) || '播放'}
                </span>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </Modal>
  );
}
