import { useState } from 'react';
import { Film } from 'lucide-react';
import { posterUrl } from '../api';

export function PosterImage({
  src,
  alt,
  className = '',
  eager = false,
}: {
  src: string;
  alt: string;
  className?: string;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={`poster-fallback ${className}`} aria-label={alt}>
        <Film size={28} />
        <span>{alt.slice(0, 8)}</span>
      </div>
    );
  }
  return (
    <img
      src={posterUrl(src)}
      alt={alt}
      className={className}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
