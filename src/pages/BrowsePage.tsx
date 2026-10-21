import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Film, RefreshCw, SlidersHorizontal, Tv } from 'lucide-react';
import type { MediaType, Subject } from '../types';
import { api } from '../api';
import { useApi } from '../hooks/useApi';
import { MediaCard } from '../components/MediaCard';
import { CardSkeleton, EmptyState } from '../components/EmptyState';
import { useToast } from '../components/Toast';

const GENRES = ['剧情', '喜剧', '爱情', '科幻', '悬疑', '犯罪', '动作', '动画', '恐怖', '纪录片', '奇幻', '冒险'];
const SORTS = [
  { value: 'heat', label: '热度优先' },
  { value: 'rating', label: '评分优先' },
  { value: 'new', label: '年份最新' },
  { value: 'views', label: '最近浏览' },
] as const;

type SortValue = (typeof SORTS)[number]['value'];

export function BrowsePage({ type }: { type: MediaType }) {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [refreshing, setRefreshing] = useState(false);

  const genre = params.get('genre') || '';
  const rawSort = params.get('sort');
  const sort: SortValue = SORTS.some((item) => item.value === rawSort)
    ? (rawSort as SortValue)
    : 'heat';
  const rawPage = Number(params.get('page') || 1);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;

  const updateQuery = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  };

  const { data, loading, error, reload } = useApi<{
    items: Subject[];
    total: number;
    page: number;
    pageSize: number;
  }>(
    () =>
      api(
        `/api/subjects?type=${type}&genre=${encodeURIComponent(genre)}&sort=${sort}&page=${page}&pageSize=30`,
      ),
    [type, genre, sort, page],
  );

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const refreshCollections = async () => {
    setRefreshing(true);
    try {
      await api('/api/admin/run', { method: 'POST', body: JSON.stringify({ job: 'collections' }) });
      toast.push('豆瓣榜单已刷新', 'success');
      reload();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : '刷新失败', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="container page browse-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">{type === 'movie' ? 'MOVIE LIBRARY' : 'SERIES LIBRARY'}</span>
          <h1>{type === 'movie' ? '电影片库' : '剧集片库'}</h1>
          <p>
            {type === 'movie'
              ? '从院线新片到影史经典，按豆瓣热度与评分浏览。'
              : '热门剧集、国产剧与欧美剧，找到下一部要追的。'}
          </p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={refreshCollections} disabled={refreshing}>
          <RefreshCw size={16} className={refreshing ? 'spin' : ''} />
          刷新榜单
        </button>
      </header>

      <section className="filter-bar">
        <div className="filter-group">
          <span className="filter-label">
            <SlidersHorizontal size={14} />
            类型
          </span>
          <div className="chips">
            <button
              type="button"
              className={`chip ${genre === '' ? 'active' : ''}`}
              onClick={() => updateQuery({ genre: null, page: null })}
            >
              全部
            </button>
            {GENRES.map((item) => (
              <button
                type="button"
                key={item}
                className={`chip ${genre === item ? 'active' : ''}`}
                onClick={() => updateQuery({ genre: item, page: null })}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-group filter-sort">
          <span className="filter-label">排序</span>
          <select
            value={sort}
            onChange={(event) => updateQuery({ sort: event.target.value, page: null })}
          >
            {SORTS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      {loading ? (
        <div className="grid-cards">
          {Array.from({ length: 15 }, (_, index) => (
            <CardSkeleton key={index} />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          title="片库加载失败"
          description={error}
          action={<button type="button" className="btn btn-primary" onClick={reload}>重试</button>}
        />
      ) : !data?.items.length ? (
        <EmptyState
          icon={type === 'movie' ? <Film size={26} /> : <Tv size={26} />}
          title={genre ? `暂无「${genre}」类型的缓存作品` : '片库还是空的'}
          description="可以刷新豆瓣榜单，或换个类型筛选看看。"
          action={<button type="button" className="btn btn-primary" onClick={refreshCollections}>刷新榜单</button>}
        />
      ) : (
        <>
          <div className="browse-summary">
            <span>共 {data.total} 部作品</span>
            <span>第 {page} / {totalPages} 页</span>
          </div>
          <div className="grid-cards">
            {data.items.map((subject) => (
              <MediaCard key={subject.id} subject={subject} />
            ))}
          </div>
          <div className="pagination">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={page <= 1}
              onClick={() => updateQuery({ page: String(Math.max(1, page - 1)) })}
            >
              <ChevronLeft size={16} />
              上一页
            </button>
            <span>
              {page} / {totalPages}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={page >= totalPages}
              onClick={() => updateQuery({ page: String(Math.min(totalPages, page + 1)) })}
            >
              下一页
              <ChevronRight size={16} />
            </button>
          </div>
          <p className="browse-footnote">
            想找具体片名？直接<Link to="/search">搜索豆瓣条目</Link>，进入详情页后即可检索网盘资源。
          </p>
        </>
      )}
    </div>
  );
}
