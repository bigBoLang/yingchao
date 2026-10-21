import { Star } from 'lucide-react';
import { formatRating } from '../lib/format';

export function Rating({ value, count, size = 'normal' }: { value: number; count?: number; size?: 'small' | 'normal' | 'large' }) {
  const stars = Math.round((value / 10) * 5);
  return (
    <div className={`rating rating-${size}`} title={value > 0 ? `${value} 分` : '暂无评分'}>
      <span className="rating-value">{formatRating(value)}</span>
      <span className="rating-stars" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <Star key={index} size={size === 'large' ? 16 : 12} className={index < stars ? 'star-on' : 'star-off'} />
        ))}
      </span>
      {count != null && count > 0 ? (
        <span className="rating-count">{Intl.NumberFormat('zh-CN').format(count)} 人评</span>
      ) : null}
    </div>
  );
}
