import { Loader2, SearchX } from 'lucide-react';

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon || <SearchX size={26} />}</div>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

export function LoadingBlock({ text = '正在加载…' }: { text?: string }) {
  return (
    <div className="loading-block">
      <Loader2 size={22} className="spin" />
      <span>{text}</span>
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="card-skeleton">
      <div className="skeleton skeleton-poster" />
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-line short" />
    </div>
  );
}
