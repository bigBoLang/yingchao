import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Play, X } from 'lucide-react';
import type { PlayHistoryItem } from '../types';
import { api } from '../api';
import { formatDuration } from '../lib/format';
import { PosterImage } from './PosterImage';

export function HistoryRow() {
  const [items, setItems] = useState<PlayHistoryItem[]>([]);
  const railRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    api<{ items: PlayHistoryItem[] }>('/api/history?limit=12')
      .then((data) => {
        if (alive) setItems(data.items || []);
      })
      .catch(() => {
        // 播放记录加载失败不影响首页其它内容
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!items.length) return null;

  const remove = (subjectId: string) => {
    setItems((list) => list.filter((item) => item.subjectId !== subjectId));
    void api(`/api/history/${encodeURIComponent(subjectId)}`, { method: 'DELETE' }).catch(() => {});
  };

  const scroll = (direction: number) => {
    railRef.current?.scrollBy({ left: direction * 620, behavior: 'smooth' });
  };

  return (
    <section className="section-block">
      <div className="section-head">
        <div>
          <span className="eyebrow">CONTINUE WATCHING</span>
          <h2>继续观看</h2>
          <p>最近播放过的影片，进度只记录在本机</p>
        </div>
        <div className="section-actions">
          <button type="button" className="rail-btn" onClick={() => scroll(-1)} aria-label="向左滚动">
            <ChevronLeft size={18} />
          </button>
          <button type="button" className="rail-btn" onClick={() => scroll(1)} aria-label="向右滚动">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <div className="rail history-rail" ref={railRef}>
        {items.map((item) => {
          const percent = item.duration > 0 ? Math.min(100, (item.position / item.duration) * 100) : 0;
          const remaining = Math.max(0, item.duration - item.position);
          return (
            <article className="history-card" key={item.subjectId}>
              <Link to={`/subject/${item.subjectId}`} className="history-poster">
                <PosterImage src={item.poster} alt={item.title} className="history-poster-img" />
                <span className="history-play">
                  <Play size={15} />
                </span>
                {item.duration > 0 ? (
                  <span className="history-progress">
                    <span style={{ width: `${percent}%` }} />
                  </span>
                ) : null}
              </Link>
              <div className="history-meta">
                <Link to={`/subject/${item.subjectId}`} className="history-title">
                  {item.title || '未知影片'}
                </Link>
                <span className="history-sub">
                  {item.completed
                    ? '已看完'
                    : item.duration > 0
                      ? `还剩 ${formatDuration(remaining)}`
                      : '播放过'}
                </span>
              </div>
              <button
                type="button"
                className="history-remove"
                aria-label={`从播放记录中移除 ${item.title}`}
                onClick={() => remove(item.subjectId)}
              >
                <X size={13} />
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
