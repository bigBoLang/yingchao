import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Cloud,
  Database,
  Loader2,
  Play,
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
import { EmptyState, LoadingBlock } from './EmptyState';
import { CLOUD_LABELS, relativeTime } from '../lib/format';

const CLOUD_FILTERS: Array<{ value: CloudType | 'all'; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'quark', label: '夸克' },
  { value: 'mobile', label: '移动' },
  { value: 'baidu', label: '百度' },
  { value: 'aliyun', label: '阿里' },
  { value: 'uc', label: 'UC' },
  { value: 'xunlei', label: '迅雷' },
  { value: 'magnet', label: '磁力' },
];

const STATUS_RANK: Record<Resource['status'], number> = {
  valid: 0,
  unknown: 1,
  locked: 2,
  invalid: 3,
};

// 资源标题里通常带着画质和字幕信息：把「高画质 + 双语/中文字幕」排到前面。
function qualityScore(text: string): number {
  if (/4k|2160p|uhd|remux|原盘/i.test(text)) return 3;
  if (/1080p|bluray|blu-ray|蓝光|bdrip/i.test(text)) return 2;
  if (/720p/i.test(text)) return 1;
  return 0;
}

function subtitleScore(text: string): number {
  if (/双语|中英|简英|简繁英|中日|多字幕|多语字幕/i.test(text)) return 2;
  if (/中字|中文字幕|简中|简繁|字幕|内嵌|内置|外挂|硬字/i.test(text)) return 1;
  return 0;
}

function resourceRank(resource: Resource): number {
  const text = `${resource.title} ${resource.note}`;
  return qualityScore(text) * 10 + subtitleScore(text);
}

export function ResourcePanel({
  subject,
  initialResources,
  initialSearchState,
  initialChannels,
  shouldSearch,
  onOpenPlayer,
  bindPlayFirst,
}: {
  subject: Subject;
  initialResources: Resource[];
  initialSearchState: SubjectBundle['searchState'];
  initialChannels: SubjectBundle['channels'];
  shouldSearch: boolean;
  onOpenPlayer: (resource: Resource, files: QuarkFile[]) => void;
  bindPlayFirst: (fn: () => void) => void;
}) {
  const toast = useToast();
  const [resources, setResources] = useState<Resource[]>(initialResources);
  const [cloud, setCloud] = useState<CloudType | 'all'>('quark');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [channelResults, setChannelResults] = useState<ChannelSearchResult[]>([]);
  const [lastSearchedAt, setLastSearchedAt] = useState(initialSearchState.lastSearchedAt);
  const [expanded, setExpanded] = useState(false);
  const autoStarted = useRef(false);

  const playFirstResource = async () => {
    const first = sorted[0];
    if (!first) return;
    toast.push('正在解析最佳资源…', 'info');
    try {
      const result = await api<{ files: QuarkFile[]; error?: string; message?: string }>(
        `/api/resources/${first.id}/resolve`,
        { method: 'POST' }
      );
      if (result.error) throw new Error(result.error);
      if (!result.files?.length) {
        toast.push(result.message || '没有解析到视频文件', 'info');
        return;
      }
      onOpenPlayer(first, result.files);
      toast.push('已打开播放器', 'success');
    } catch (error) {
      toast.push(error instanceof Error ? error.message : '解析失败', 'error');
    }
  };

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
    () => {
      const base = cloud === 'all' ? resources : resources.filter((resource) => resource.cloudType === cloud);
      // 只保留经过检测确认有效的链接，失效和未检测的一律不展示。
      return base.filter((resource) => resource.status === 'valid');
    },
    [resources, cloud],
  );

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      // 画质和字幕优先：4K/蓝光原盘、带双语或中文字幕的资源排前面。
      const rankDiff = resourceRank(b) - resourceRank(a);
      if (rankDiff !== 0) return rankDiff;
      const statusDiff = STATUS_RANK[a.status] - STATUS_RANK[b.status];
      if (statusDiff !== 0) return statusDiff;
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      return b.lastSeenAt - a.lastSeenAt;
    });
  }, [filtered]);

  const visibleResources = expanded ? sorted : sorted.slice(0, 5);

  // 顶部「播放最佳资源」按钮复用这里的同一套选择与解析逻辑
  useEffect(() => {
    bindPlayFirst(playFirstResource);
  });

  useEffect(() => {
    setExpanded(false);
  }, [cloud, subject.id]);

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
            支持夸克与移动云盘。链接来自公开搜索渠道，缓存于本地并定期检测可用性。
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
          自动检测夸克 / 移动云盘分享有效性
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
          title={resources.length ? `暂无有效${CLOUD_LABELS[cloud] || ''}资源` : '还没有缓存资源'}
          description={
            resources.length
              ? '缓存中的链接尚未通过有效性检测，后台会自动复查；也可以重新检索。'
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
        {visibleResources.map((resource) => (
          <ResourceCard
            key={resource.id}
            resource={resource}
            onResolved={(target, files) => onOpenPlayer(target, files)}
            onChecked={(updated) =>
              setResources((current) =>
                current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)),
              )
            }
          />
        ))}
      </div>

      {sorted.length > 5 ? (
        <div className="resource-more">
          <span>
            {expanded
              ? `已展开全部 ${sorted.length} 条`
              : `按画质、字幕与匹配度优先展示前 5 条，另有 ${sorted.length - 5} 条`}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? '收起' : `展开全部 ${sorted.length} 条`}
          </button>
        </div>
      ) : null}

      {resources.length > 0 ? (
        <div className="resource-footnote">
          <span>
            <Database size={14} />
            共 {filtered.length} 条有效资源，当前显示 {visibleResources.length} 条
          </span>
          <span>已过滤失效与未检测链接，后台巡检会定期复查。</span>
        </div>
      ) : null}
    </section>
  );
}
