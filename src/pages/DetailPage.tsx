import { useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Film,
  HardDrive,
  Play,
  Star,
  Tv,
  Users,
} from 'lucide-react';
import type { MediaType, QuarkFile, Resource, Subject, SubjectBundle } from '../types';
import { api } from '../api';
import { useApi } from '../hooks/useApi';
import { PosterImage } from '../components/PosterImage';
import { Rating } from '../components/Rating';
import { ResourcePanel } from '../components/ResourcePanel';
import { PlayerModal } from '../components/PlayerModal';
import { EmptyState } from '../components/EmptyState';
import { MediaCard } from '../components/MediaCard';
import { formatCount, typeLabel } from '../lib/format';

export function DetailPage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const type = (params.get('type') || '') as MediaType | '';
  const [expanded, setExpanded] = useState(false);
  const [player, setPlayer] = useState<{ resource: Resource; files: QuarkFile[] } | null>(null);
  const playBestRef = useRef<() => void>(() => {});

  const { data, loading, error, reload } = useApi<SubjectBundle>(
    () => api(`/api/subjects/${id}${type ? `?type=${type}` : ''}`),
    [id, type],
  );

  const subject = data?.subject;
  const mediaType = subject?.type || type || 'movie';

  const related = useApi<{ items: Subject[] }>(
    () =>
      api(`/api/subjects?type=${mediaType}&sort=rating&pageSize=12`),
    [mediaType],
  );

  const relatedItems = useMemo(
    () => (related.data?.items || []).filter((item) => item.id !== id).slice(0, 6),
    [related.data, id],
  );

  if (loading) {
    return (
      <div className="container page detail-page">
        <div className="detail-skeleton">
          <div className="skeleton skeleton-detail-poster" />
          <div className="detail-skeleton-info">
            <div className="skeleton skeleton-line tiny" />
            <div className="skeleton skeleton-title" />
            <div className="skeleton skeleton-line medium" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !subject || !data) {
    return (
      <div className="container page">
        <EmptyState
          title="没有找到这个条目"
          description={error || '可能已被删除，或豆瓣接口暂时不可用。'}
          action={
            <div className="empty-actions">
              <button type="button" className="btn btn-primary" onClick={reload}>重试</button>
              <Link to="/" className="btn btn-ghost">返回首页</Link>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="detail-page">
      <div className="detail-backdrop" aria-hidden="true">
        {subject.poster ? <img src={`/api/image?url=${encodeURIComponent(subject.poster)}`} alt="" /> : null}
        <div className="detail-backdrop-shade" />
      </div>

      <div className="container detail-container">
        <button type="button" className="back-link" onClick={() => history.back()}>
          <ArrowLeft size={16} />
          返回
        </button>

        <section className="detail-hero">
          <div className="detail-poster-col">
            <PosterImage src={subject.poster} alt={subject.title} className="detail-poster" eager />
            {subject.rank ? <span className="detail-rank">榜单 #{subject.rank}</span> : null}
          </div>

          <div className="detail-info">
            <div className="detail-kicker">
              <span className="pill pill-accent">{typeLabel(subject.type)}</span>
              {subject.episodesInfo ? <span className="pill">{subject.episodesInfo}</span> : null}
              {subject.genres?.map((genre) => (
                <Link to={`/${subject.type === 'tv' ? 'tv' : 'movies'}?genre=${encodeURIComponent(genre)}`} className="pill pill-link" key={genre}>
                  {genre}
                </Link>
              ))}
            </div>

            <h1>{subject.title}</h1>
            {subject.originalTitle ? <p className="detail-original">{subject.originalTitle}</p> : null}
            {subject.aka?.length ? <p className="detail-aka">又名：{subject.aka.slice(0, 3).join(' / ')}</p> : null}

            <div className="detail-meta">
              <span><CalendarDays size={15} />{subject.year || '年份未知'}</span>
              {subject.duration ? <span>{subject.duration}</span> : null}
              {subject.episodes ? <span><Tv size={15} />共 {subject.episodes} 集</span> : null}
              {subject.countries?.length ? <span>{subject.countries.join(' / ')}</span> : null}
              {subject.pubdate?.[0] ? <span>{subject.pubdate[0]}</span> : null}
            </div>

            <div className="detail-rating-row">
              {subject.rating > 0 ? (
                <div className="rating-card">
                  <div className="rating-big">
                    <strong>{subject.rating.toFixed(1)}</strong>
                    <span>/ 10</span>
                  </div>
                  <div>
                    <Rating value={subject.rating} count={subject.ratingCount} size="normal" />
                    <p>豆瓣评分</p>
                  </div>
                </div>
              ) : (
                <div className="rating-card rating-empty">
                  <Star size={20} />
                  <span>豆瓣暂无评分</span>
                </div>
              )}
              <div className="detail-resource-stat">
                <HardDrive size={18} />
                <div>
                  <strong>{data.resources.length}</strong>
                  <span>条缓存资源</span>
                </div>
              </div>
            </div>

            <div className="detail-credits">
              {subject.directors?.length ? (
                <div>
                  <span>导演</span>
                  <p>{subject.directors.join(' / ')}</p>
                </div>
              ) : null}
              {subject.actors?.length ? (
                <div>
                  <span>主演</span>
                  <p>{subject.actors.slice(0, 8).join(' / ')}</p>
                </div>
              ) : null}
            </div>

            <div className={`detail-intro ${expanded ? 'expanded' : ''}`}>
              <p>{subject.intro || '豆瓣暂无简介。'}</p>
              {subject.intro && subject.intro.length > 120 ? (
                <button type="button" onClick={() => setExpanded((value) => !value)}>
                  {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {expanded ? '收起' : '展开全部'}
                </button>
              ) : null}
            </div>

            <div className="detail-actions">
              <a className="btn btn-ghost" href={`https://movie.douban.com/subject/${subject.id}/`} target="_blank" rel="noreferrer">
                <ExternalLink size={16} />
                豆瓣详情
              </a>
              <a className="btn btn-ghost" href={`https://www.douban.com/search?q=${encodeURIComponent(subject.title)}`} target="_blank" rel="noreferrer">
                <Users size={16} />
                豆瓣讨论
              </a>
              {data.resources.length > 0 && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => playBestRef.current()}
                >
                  <Play size={14} />
                  播放最佳资源
                </button>
              )}
              <span className="detail-views">
                <Film size={14} />
                {formatCount(subject.views || 0)} 次浏览
              </span>
            </div>
          </div>
        </section>

        <ResourcePanel
          key={`${subject.id}-${data.searchState.lastSearchedAt}`}
          subject={subject}
          initialResources={data.resources}
          initialSearchState={data.searchState}
          initialChannels={data.channels}
          shouldSearch={data.shouldSearch}
          onOpenPlayer={(resource, files) => setPlayer({ resource, files })}
          bindPlayFirst={(fn) => {
            playBestRef.current = fn;
          }}
        />

        {relatedItems.length ? (
          <section className="related-section">
            <div className="section-head">
              <div>
                <span className="eyebrow">MORE LIKE THIS</span>
                <h2>你可能还喜欢</h2>
                <p>同为{subject.type === 'tv' ? '剧集' : '电影'}的高分作品</p>
              </div>
            </div>
            <div className="grid-cards grid-related">
              {relatedItems.map((item) => (
                <MediaCard key={item.id} subject={item} />
              ))}
            </div>
          </section>
        ) : null}
      </div>

      {player ? (
        <PlayerModal resource={player.resource} files={player.files} onClose={() => setPlayer(null)} />
      ) : null}
    </div>
  );
}
