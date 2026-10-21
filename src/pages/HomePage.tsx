import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  Database,
  Film,
  HardDrive,
  Radio,
  Sparkles,
  Tv,
} from 'lucide-react';
import type { HomeResponse } from '../types';
import { api } from '../api';
import { useApi } from '../hooks/useApi';
import { Hero } from '../components/Hero';
import { SectionRow } from '../components/SectionRow';
import { CardSkeleton, EmptyState } from '../components/EmptyState';
import { formatCount } from '../lib/format';

export function HomePage() {
  const { data, loading, error, reload } = useApi<HomeResponse>(() => api('/api/home'), []);

  if (loading) {
    return (
      <div className="container page">
        <div className="hero-skeleton">
          <div>
            <div className="skeleton skeleton-line tiny" />
            <div className="skeleton skeleton-title" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line medium" />
          </div>
          <div className="skeleton skeleton-hero-poster" />
        </div>
        <div className="grid-cards">
          {Array.from({ length: 8 }, (_, index) => (
            <CardSkeleton key={index} />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="container page">
        <EmptyState
          title="暂时没能加载豆瓣数据"
          description={error || '请检查网络后重试。豆瓣接口偶尔会限流，稍后再试通常可以恢复。'}
          action={
            <button type="button" className="btn btn-primary" onClick={reload}>
              重新加载
            </button>
          }
        />
      </div>
    );
  }

  const stats = data.stats;

  return (
    <div className="home-page">
      {data.hero ? <Hero subject={data.hero} /> : null}

      <div className="container">
        <section className="stats-strip">
          <div className="stat">
            <span className="stat-icon"><Film size={17} /></span>
            <div>
              <strong>{formatCount(stats.movies)}</strong>
              <span>部电影</span>
            </div>
          </div>
          <div className="stat">
            <span className="stat-icon"><Tv size={17} /></span>
            <div>
              <strong>{formatCount(stats.tvs)}</strong>
              <span>部剧集</span>
            </div>
          </div>
          <div className="stat">
            <span className="stat-icon"><Database size={17} /></span>
            <div>
              <strong>{formatCount(stats.resources)}</strong>
              <span>条缓存资源</span>
            </div>
          </div>
          <div className="stat">
            <span className="stat-icon"><Activity size={17} /></span>
            <div>
              <strong>{formatCount(stats.validResources)}</strong>
              <span>条有效链接</span>
            </div>
          </div>
          <div className="stat">
            <span className="stat-icon"><Radio size={17} /></span>
            <div>
              <strong>{stats.enabledChannels}</strong>
              <span>个检索渠道</span>
            </div>
          </div>
        </section>

        <section className="feature-strip">
          <div className="feature-strip-icon">
            <Sparkles size={18} />
          </div>
          <p>
            <strong>先看豆瓣评分，再找网盘资源。</strong>
            站点会把热门影视的资源信息缓存到本地，并定期检测链接有效性，热门内容无需每次重新搜索。
          </p>
          <Link to="/settings" className="feature-strip-link">
            管理渠道
            <ArrowRight size={15} />
          </Link>
        </section>

        {data.sections.map((section, index) => (
          <SectionRow key={section.key} section={section} index={index} />
        ))}

        <section className="home-bottom">
          <div>
            <span className="eyebrow">EXPLORE MORE</span>
            <h2>按类型慢慢逛</h2>
            <p>从正在热映到高分经典，豆瓣片库已经同步到本地。</p>
          </div>
          <div className="home-bottom-links">
            <Link to="/movies" className="category-tile">
              <Film size={22} />
              <div>
                <strong>电影片库</strong>
                <span>{formatCount(stats.movies)} 部作品</span>
              </div>
              <ArrowRight size={18} />
            </Link>
            <Link to="/tv" className="category-tile">
              <Tv size={22} />
              <div>
                <strong>剧集片库</strong>
                <span>{formatCount(stats.tvs)} 部作品</span>
              </div>
              <ArrowRight size={18} />
            </Link>
            <Link to="/search" className="category-tile">
              <HardDrive size={22} />
              <div>
                <strong>全网搜索</strong>
                <span>按片名查找资源</span>
              </div>
              <ArrowRight size={18} />
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
