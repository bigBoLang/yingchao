import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, Search, Sparkles } from 'lucide-react';
import type { SearchSuggestResponse } from '../types';
import { api } from '../api';
import { useApi } from '../hooks/useApi';
import { MediaCard } from '../components/MediaCard';
import { CardSkeleton, EmptyState } from '../components/EmptyState';

const HOT_KEYWORDS = ['流浪地球', '肖申克的救赎', '繁花', '庆余年', '三体', '奥本海默', '疯狂动物城', '甄嬛传'];

export function SearchPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const query = params.get('q') || '';
  const [input, setInput] = useState(query);

  useEffect(() => setInput(query), [query]);

  const { data, loading, error } = useApi<SearchSuggestResponse>(
    () => (query ? api(`/api/search?q=${encodeURIComponent(query)}`) : Promise.resolve({ query: '', items: [] })),
    [query],
  );

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = input.trim();
    if (value) navigate(`/search?q=${encodeURIComponent(value)}`);
  };

  return (
    <div className="container page search-page">
      <header className="search-hero">
        <span className="eyebrow">SEARCH DOUBAN</span>
        <h1>搜一部想看的</h1>
        <p>先用豆瓣找到准确的影视条目，再进入详情页检索夸克等网盘资源。</p>
        <form className="big-search" onSubmit={submit}>
          <Search size={20} />
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="输入电影名、剧名或演员…"
            autoFocus
          />
          <button type="submit" className="btn btn-primary">
            搜索
          </button>
        </form>
        {!query ? (
          <div className="hot-keywords">
            <span>
              <Sparkles size={14} />
              试试这些
            </span>
            {HOT_KEYWORDS.map((keyword) => (
              <button
                type="button"
                key={keyword}
                className="chip"
                onClick={() => navigate(`/search?q=${encodeURIComponent(keyword)}`)}
              >
                {keyword}
              </button>
            ))}
          </div>
        ) : null}
      </header>

      {query ? (
        <section className="search-results">
          <div className="search-results-head">
            <h2>
              「{query}」的搜索结果
              {data ? <span>{data.items.length} 条</span> : null}
            </h2>
            {data?.warning ? <span className="inline-warning">{data.warning}</span> : null}
          </div>
          {loading ? (
            <div className="grid-cards">
              {Array.from({ length: 8 }, (_, index) => (
                <CardSkeleton key={index} />
              ))}
            </div>
          ) : error ? (
            <EmptyState title="搜索失败" description={error} />
          ) : !data?.items.length ? (
            <EmptyState
              icon={<Search size={26} />}
              title="没有找到匹配的条目"
              description="换个片名或减少关键词试试。豆瓣搜索对完整片名更敏感。"
            />
          ) : (
            <div className="grid-cards">
              {data.items.map((subject) => (
                <MediaCard key={`${subject.type}-${subject.id}`} subject={subject} />
              ))}
            </div>
          )}
        </section>
      ) : (
        <div className="search-loading-hint">
          <Loader2 size={18} className="spin" />
          输入片名开始搜索
        </div>
      )}
    </div>
  );
}
