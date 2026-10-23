import type HlsType from 'hls.js';
import { useEffect, useRef, useState } from 'react';

export function VideoPlayer({
  src,
  format,
}: {
  src: string;
  format?: 'hls' | 'video';
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const isHls = format === 'hls' || /\.m3u8(\?|$)/i.test(src);

  useEffect(() => {
    // 先清错误：否则出错后 <video> 被隐藏，ref 取不到，换新地址也永远无法重试。
    setError('');
    const video = videoRef.current;
    if (!video || !src) return;

    if (!isHls) {
      video.src = src;
      return;
    }

    // Safari / iOS 原生支持 HLS，交给系统播放器即可。
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      return;
    }

    let cancelled = false;
    let hls: HlsType | null = null;

    void import('hls.js')
      .then(({ default: Hls }) => {
        if (cancelled) return;
        if (!Hls.isSupported()) {
          setError('当前浏览器不支持 HLS 播放，请使用 IINA / VLC 打开。');
          return;
        }
        hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 90,
        });
        hls.loadSource(src);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls?.recoverMediaError();
            return;
          }
          setError(`播放失败：${data.details || '视频流加载异常'}。可以改用 IINA / VLC。`);
          hls?.destroy();
        });
      })
      .catch(() => {
        if (!cancelled) setError('HLS 播放器加载失败，请使用 IINA / VLC 打开。');
      });

    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [src, format]);

  return (
    <>
      <video
        ref={videoRef}
        className="video-player"
        style={error ? { display: 'none' } : undefined}
        controls
        playsInline
        preload="metadata"
        onError={() =>
          setError(
            isHls
              ? '视频流加载失败，链接可能已过期，关闭后重新解析即可。'
              : '浏览器无法播放这个视频（原画常见 MKV / H.265），请用下方的 IINA / VLC 打开。',
          )
        }
      />
      {error && (
        <div className="player-placeholder player-hls-error">
          <p>{error}</p>
          <span>播放列表或分片链接可能已过期，关闭后重新点击解析播放即可。</span>
        </div>
      )}
    </>
  );
}
