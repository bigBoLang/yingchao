import { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Section } from '../types';
import { MediaCard } from './MediaCard';

export function SectionRow({ section, index = 0 }: { section: Section; index?: number }) {
  const railRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: number) => {
    railRef.current?.scrollBy({ left: direction * 620, behavior: 'smooth' });
  };

  return (
    <section className="section-block" style={{ animationDelay: `${Math.min(index, 5) * 70}ms` }}>
      <div className="section-head">
        <div>
          <span className="eyebrow">{section.type === 'tv' ? 'SERIES' : 'CINEMA'}</span>
          <h2>{section.title}</h2>
          <p>{section.subtitle}</p>
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
      <div className="rail" ref={railRef}>
        {section.items.map((subject, cardIndex) => (
          <MediaCard key={`${section.key}-${subject.id}`} subject={subject} eager={index === 0 && cardIndex < 4} />
        ))}
      </div>
    </section>
  );
}
