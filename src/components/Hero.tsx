import { Link } from 'react-router-dom';
import { CalendarDays, ChevronRight, HardDrive, Play, Star } from 'lucide-react';
import type { Subject } from '../types';
import { PosterImage } from './PosterImage';
import { Rating } from './Rating';
import { typeLabel } from '../lib/format';

export function Hero({ subject }: { subject: Subject }) {
  return (
    <section className="hero">
      <div className="hero-backdrop" aria-hidden="true">
        {subject.poster ? <img src={`/api/image?url=${encodeURIComponent(subject.poster)}`} alt="" /> : null}
        <div className="hero-backdrop-shade" />
      </div>
      <div className="hero-inner">
        <div className="hero-copy">
          <div className="hero-badges">
            <span className="pill pill-accent">
              <Star size={12} fill="currentColor" />
              本周热映
            </span>
            <span className="pill">{typeLabel(subject.type)}</span>
            {subject.genres?.slice(0, 2).map((genre) => (
              <span className="pill" key={genre}>
                {genre}
              </span>
            ))}
          </div>
          <h1>{subject.title}</h1>
          {subject.originalTitle ? <p className="hero-original">{subject.originalTitle}</p> : null}
          <div className="hero-meta">
            <span>
              <CalendarDays size={14} />
              {subject.year || '年份未知'}
            </span>
            {subject.duration ? <span>{subject.duration}</span> : null}
            {subject.episodes ? <span>共 {subject.episodes} 集</span> : null}
            {subject.countries?.[0] ? <span>{subject.countries[0]}</span> : null}
          </div>
          {subject.rating > 0 ? <Rating value={subject.rating} count={subject.ratingCount} size="large" /> : null}
          <p className="hero-intro">{subject.intro || '豆瓣暂无简介，点击查看详情与网盘资源。'}</p>
          <div className="hero-cta">
            <Link to={`/subject/${subject.id}?type=${subject.type}`} className="btn btn-primary">
              <Play size={16} fill="currentColor" />
              查看网盘资源
            </Link>
            <a
              className="btn btn-ghost"
              href={`https://movie.douban.com/subject/${subject.id}/`}
              target="_blank"
              rel="noreferrer"
            >
              豆瓣页面
              <ChevronRight size={16} />
            </a>
            {subject.resourceCount ? (
              <span className="hero-cache">
                <HardDrive size={14} />
                已缓存 {subject.resourceCount} 条资源
              </span>
            ) : null}
          </div>
        </div>
        <div className="hero-poster-wrap">
          <div className="hero-poster-glow" />
          <PosterImage src={subject.poster} alt={subject.title} className="hero-poster" eager />
          <div className="hero-poster-frame" />
        </div>
      </div>
    </section>
  );
}
