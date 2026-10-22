import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  FolderOpen,
  Loader2,
  MonitorPlay,
  Play,
  Server,
  Terminal,
} from 'lucide-react';
import type { QuarkFile, Resource } from '../types';
import { api, absoluteUrl, copyText } from '../api';
import { Modal } from './Modal';
import { useToast } from './Toast';
import { VideoPlayer } from './VideoPlayer';
import { formatBytes } from '../lib/format';

export function PlayerModal({
  resource,
  files,
  onClose,
}: {
  resource: Resource;
  files: QuarkFile[];
  onClose: () => void;
}) {
  const toast = useToast();
  const [selected, setSelected] = useState(0);
  const [copied, setCopied] = useState(false);
  const [playUrl, setPlayUrl] = useState('');
  const [playFormat, setPlayFormat] = useState<'hls' | 'video' | undefined>();
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState('');
  const [player, setPlayer] = useState({
    iina: true,
    vlc: true,
    potplayer: false,
    mpv: true,
    defaultExternal: 'iina',
  });

  useEffect(() => {
    api<{ player: typeof player }>('/api/config')
      .then((data) => setPlayer((current) => ({ ...current, ...data.player })))
      .catch(() => undefined);
  }, []);

  const file = files[selected];
  const shareUrl = resource.url;
  const isMobile = resource.cloudType === 'mobile';

  useEffect(() => {
    if (!file) {
      setPlayUrl('');
      setPlayFormat(undefined);
      setResolveError('');
      setResolving(false);
      return;
    }
    const localUrl = file.proxyUrl ? absoluteUrl(file.proxyUrl) : file.directUrl || '';
    if (localUrl) {
      setPlayUrl(localUrl);
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
      setResolveError('没有拿到文件 ID，请重新解析资源');
      setResolving(false);
      return;
    }

    let cancelled = false;
    setPlayUrl('');
    setPlayFormat(undefined);
    setResolveError('');
    setResolving(true);
    api<{ proxyUrl?: string; format?: 'hls' | 'video' }>(`/api/resources/${resource.id}/play`, {
      method: 'POST',
      body: JSON.stringify({
        fid: file.fid,
        name: file.name,
        size: file.size,
      }),
    })
      .then((result) => {
        if (cancelled) return;
        if (!result.proxyUrl) throw new Error('服务端没有返回播放地址');
        setPlayUrl(absoluteUrl(result.proxyUrl));
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
  }, [file?.fid, file?.proxyUrl, file?.directUrl, resource.id]);

  const protocols = useMemo(
    () => ({
      iina: playUrl ? `iina://weblink?url=${encodeURIComponent(playUrl)}` : '',
      vlc: playUrl ? `vlc://${playUrl}` : '',
      potplayer: playUrl ? `potplayer://${playUrl}` : '',
    }),
    [playUrl],
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
            播放地址经由本机代理转发，服务关闭后将失效
          </span>
          {resource.password ? <span className="password-chip">提取码 {resource.password}</span> : null}
        </div>
      }
    >
      <div className="player-layout">
        <div className="player-main">
          {playUrl ? (
            <VideoPlayer key={playUrl} src={playUrl} format={playFormat} />
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
            {playUrl ? (
              <>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(playUrl, '播放地址已复制')}>
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                  复制直链
                </button>
                {player.iina ? (
                  <a className="btn btn-ghost btn-sm" href={protocols.iina}>
                    <ExternalLink size={15} />
                    IINA
                  </a>
                ) : null}
                {player.vlc ? (
                  <a className="btn btn-ghost btn-sm" href={protocols.vlc}>
                    <ExternalLink size={15} />
                    VLC
                  </a>
                ) : null}
                {player.potplayer ? (
                  <a className="btn btn-ghost btn-sm" href={protocols.potplayer}>
                    <ExternalLink size={15} />
                    PotPlayer
                  </a>
                ) : null}
                {player.mpv ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => copy(`mpv "${playUrl}"`, '已复制 MPV 命令')}
                  >
                    <Terminal size={15} />
                    MPV 命令
                  </button>
                ) : null}
              </>
            ) : null}
            <a className="btn btn-ghost btn-sm" href={shareUrl} target="_blank" rel="noreferrer">
              <FolderOpen size={15} />
              打开原分享
            </a>
          </div>

          <p className="player-tip">
            {isMobile
              ? '移动云盘分享会返回 HLS 播放列表，影巢会把播放列表和分片统一代理到本机，浏览器、IINA、VLC 都可以直接播放。'
              : '夸克分享首次播放会按需转存到你的「影巢播放缓存」目录，之后再次播放会直接复用。'}
            浏览器无法播放 MKV / H.265 时，请改用 IINA 或 VLC。外部播放器需要先在「设置 → 播放器」中启用。
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
