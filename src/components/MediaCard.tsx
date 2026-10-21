import { Link } from 'react-router-dom';
import { HardDrive, Play } from 'lucide-react';
import type { Subject } from '../types';
import { PosterImage } from './PosterImage';
import { Rating } from './Rating';
import { typeLabel } from '../lib/format';

export function MediaCard({ subject, eager = false }: { subject: Subject; eager?: boolean }) {
  return (
    <Link to={`/subject/${subject.id}?type=${subject.type}`} className="media-card">
      <div className="media-card-poster">
        <PosterImage src={subject.poster} alt={subject.title} eager={eager} />
        <div className="media-card-shade" />
        {subject.rating > 0 ? (
          <span className="media-card-rating">{subject.rating.toFixed(1)}</span>
        ) : null}
        {subject.resourceCount ? (
          <span className="media-card-resources" title={`已缓存 ${subject.resourceCount} 条资源`}>
            <HardDrive size={12} />
            {subject.resourceCount}
          </span>
        ) : null}
        <div className="media-card-hover">
          <span className="media-card-play">
            <Play size={18} fill="currentColor" />
          </span>
          <span>查看资源</span>
        </div>
      </div>
      <div className="media-card-body">
        <h3 title={subject.title}>{subject.title}</h3>
        <p>
          {subject.year || '年份未知'}
          <span className="dot">·</span>
          {subject.genres?.[0] || typeLabel(subject.type)}
        </p>
        {subject.rating > 0 ? <Rating value={subject.rating} size="small" /> : null}
      </div>
    </Link>
  );
}
