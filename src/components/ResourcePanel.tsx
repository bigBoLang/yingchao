import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Cloud,
  Database,
  Loader2,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type {
  ChannelSearchResult,
  CloudType,
  QuarkFile,
  Resource,
  SearchResponse,
  Subject,
  SubjectBundle,
} from '../types';
import { api } from '../api';
import { useToast } from './Toast';
import { ResourceCard } from './ResourceCard';
import { PlayerModal } from './PlayerModal';
import { EmptyState, LoadingBlock } from './EmptyState';
import { CLOUD_LABELS, relativeTime } from '../lib/format';

const CLOUD_FILTERS: Array<{ value: CloudType | 'all'; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'quark', label: '夸克' },
  { value: 'baidu', label: '百度' },
  { value: 'aliyun', label: '阿里' },
  { value: 'uc', label: 'UC' },
  { value: 'xunlei', label: '迅雷' },
  { value: 'magnet', label: '磁力' },
];

export function ResourcePanel({
  subject,
  initialResources,
  initialSearchState,
  initialChannels,
  shouldSearch,
}: {
  subject: Subject;
  initialResources: Resource[];
  initialSearchState: SubjectBundle['searchState'];
  initialChannels: SubjectBundle['channels'];
  shouldSearch: boolean;
}) {
  const toast = useToast();
  const [resources, setResources] = useState<Resource[]>(initialResources);
  const [cloud, setCloud] = useState<CloudType | 'all'>('quark');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [channelResults, setChannelResults] = useState<ChannelSearchResult[]>([]);
  const [lastSearchedAt, setLastSearchedAt] = useState(initialSearchState.lastSearchedAt);
  const [player, setPlayer] = useState<{ resource: Resource; files: QuarkFile[] } | null>(null);
  const autoStarted = useRef(false);

  const runSearch = async (force = true, cloudType: CloudType | 'all' = cloud) => {
    setLoading(true);
    setError('');
    try {
      const result = await api<SearchResponse>(`/api/subjects/${subject.id}/search`, {
        method: 'POST',
        body: JSON.stringify({ force, cloudType }),
      });
      setResources(result.resources);
      setChannelResults(result.channels);
      setLastSearchedAt(result.searchedAt);
      const errors = result.channels.filter((channel) => channel.error);
      if (errors.length) {
        toast.push(`${errors.length} 个渠道返回错误，可展开查看详情`, 'info');
      } else if (result.resources.length === 0) {
        toast.push('没有检索到资源，可以尝试其他网盘或稍后再试', 'info');
      } else {
        toast.push(`检索完成，共 ${result.resources.length} 条缓存资源`, 'success');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!shouldSearch || autoStarted.current) return;
    autoStarted.current = true;
    void runSearch(false, 'quark');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldSearch]);

  const filtered = useMemo(
    () => (cloud === 'all' ? resources : resources.filter((resource) => resource.cloudType === cloud)),
    [resources, cloud],
  );

  const channelErrors = channelResults.filter((channel) => channel.error);
  const activeChannels = initialChannels.filter((channel) => channel.enabled);

  return (
    <section className="resource-panel" id="resources">
      <div className="resource-panel-head">
        <div>
          <span className="eyebrow">NETDISK SEARCH</span>
          <h2>
            网盘资源
            <span className="resource-count">{resources.length}</span>
          </h2>
          <p>
            默认检索夸克网盘。链接来自公开搜索渠道，缓存于本地并定期检测可用性。
          </p>
        </div>
        <div className="resource-panel-actions">
          <span className="cache-time">
            <Database size={14} />
            {lastSearchedAt ? `缓存于 ${relativeTime(lastSearchedAt)}` : '尚未检索'}
          </span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => runSearch(true)}
            disabled={loading}
          >
            {loading ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
            {loading ? '检索中…' : '重新检索'}
          </button>
        </div>
      </div>

      <div className="cloud-filter-row">
        <div className="cloud-filters">
          <Cloud size={15} />
          {CLOUD_FILTERS.map((item) => (
            <button
              type="button"
              key={item.value}
              className={`chip ${cloud === item.value ? 'active' : ''}`}
              onClick={() => setCloud(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span className="resource-hint">
          <ShieldCheck size={14} />
          自动检测夸克分享有效性
        </span>
      </div>

      {channelErrors.length > 0 ? (
        <details className="channel-warnings">
          <summary>
            <AlertTriangle size={15} />
            {channelErrors.length} 个渠道本次没有返回结果
          </summary>
          <ul>
            {channelErrors.map((result) => (
              <li key={result.channel.id}>
                <strong>{result.channel.name}</strong>
                <span>{result.error}</span>
                {result.channel.type === 'pansou' ? (
                  <Link to="/settings">检查 PanSou 地址</Link>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {error ? (
        <div className="inline-error">
          <AlertTriangle size={16} />
          {error}
        </div>
      ) : null}

      {loading && resources.length === 0 ? (
        <LoadingBlock text="正在并发检索已启用的渠道，首次可能需要几秒…" />
      ) : null}

      {!loading && filtered.length === 0 ? (
        <EmptyState
          icon={<Search size={26} />}
          title={resources.length ? `暂无${CLOUD_LABELS[cloud] || ''}资源` : '还没有缓存资源'}
          description={
            resources.length
              ? '切换网盘类型，或针对当前网盘重新检索。'
              : activeChannels.length
                ? `已启用 ${activeChannels.length} 个渠道。点击下方按钮开始检索，结果会写入本地缓存。`
                : '还没有启用的检索渠道，请先到设置中添加 PanSou 或其他渠道。'
          }
          action={
            <div className="empty-actions">
              <button type="button" className="btn btn-primary" onClick={() => runSearch(true)} disabled={loading}>
                {loading ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
                立即检索
              </button>
              <Link to="/settings" className="btn btn-ghost">
                <Settings2 size={16} />
                渠道设置
              </Link>
            </div>
          }
        />
      ) : null}

      <div className="resource-list">
        {filtered.map((resource) => (
          <ResourceCard
            key={resource.id}
            resource={resource}
            onResolved={(target, files) => setPlayer({ resource: target, files })}
            onChecked={(updated) =>
              setResources((current) =>
                current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)),
              )
            }
          />
        ))}
      </div>

      {resources.length > 0 ? (
        <div className="resource-footnote">
          <span>
            <Database size={14} />
            共 {resources.length} 条缓存，当前显示 {filtered.length} 条
          </span>
          <span>失效链接会被隐藏，后台巡检会定期复查。</span>
        </div>
      ) : null}

      {player ? (
        <PlayerModal resource={player.resource} files={player.files} onClose={() => setPlayer(null)} />
      ) : null}
    </section>
  );
}
