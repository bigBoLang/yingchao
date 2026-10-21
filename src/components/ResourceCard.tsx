import { useState } from 'react';
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import type { QuarkFile, Resource, ResolveResponse } from '../types';
import { api, copyText } from '../api';
import { useToast } from './Toast';
import {
  CLOUD_COLORS,
  CLOUD_LABELS,
  STATUS_META,
  relativeTime,
} from '../lib/format';

const DIRECT_VIDEO = /^https?:\/\/.+\.(mp4|mkv|mov|m4v|webm|ts|flv|avi)(\?|$)/i;

export function ResourceCard({
  resource,
  onResolved,
  onChecked,
}: {
  resource: Resource;
  onResolved: (resource: Resource, files: QuarkFile[]) => void;
  onChecked: (resource: Resource) => void;
}) {
  const toast = useToast();
  const [resolving, setResolving] = useState(false);
  const [checking, setChecking] = useState(false);
  const status = STATUS_META[resource.status] || STATUS_META.unknown;
  const cloudLabel = CLOUD_LABELS[resource.cloudType] || resource.cloudType;
  const cloudColor = CLOUD_COLORS[resource.cloudType] || CLOUD_COLORS.other;
  const isQuark = resource.cloudType === 'quark';
  const isDirectVideo = DIRECT_VIDEO.test(resource.url);

  const copy = async () => {
    try {
      await copyText(resource.url);
      toast.push('链接已复制', 'success');
    } catch {
      toast.push('复制失败', 'error');
    }
  };

  const resolve = async () => {
    setResolving(true);
    try {
      const result = await api<ResolveResponse>(`/api/resources/${resource.id}/resolve`, {
        method: 'POST',
      });
      if (result.error) throw new Error(result.error);
      if (!result.files?.length) {
        toast.push(result.message || '没有解析到视频文件', 'info');
        return;
      }
      onResolved(resource, result.files);
    } catch (error) {
      toast.push(error instanceof Error ? error.message : '解析失败', 'error');
    } finally {
      setResolving(false);
    }
  };

  const check = async () => {
    setChecking(true);
    try {
      const result = await api<{ resource: Resource }>(`/api/resources/${resource.id}/check`, {
        method: 'POST',
      });
      onChecked(result.resource);
      toast.push(`检测完成：${STATUS_META[result.resource.status]?.label || '未知'}`, 'success');
    } catch (error) {
      toast.push(error instanceof Error ? error.message : '检测失败', 'error');
    } finally {
      setChecking(false);
    }
  };

  return (
    <article className="resource-card">
      <div className="resource-icon" style={{ color: cloudColor, borderColor: `${cloudColor}44` }}>
        <span style={{ background: `${cloudColor}1f` }}>{cloudLabel.slice(0, 1)}</span>
      </div>

      <div className="resource-content">
        <div className="resource-topline">
          <span className={`cloud-badge cloud-${resource.cloudType}`}>{cloudLabel}</span>
          <span className="channel-badge">{resource.channelName || '未知渠道'}</span>
          <span className={`status-dot ${status.className}`} title={status.hint}>
            {resource.status === 'valid' ? <ShieldCheck size={12} /> : <span />}
            {status.label}
          </span>
          <span className="resource-time">检测于 {relativeTime(resource.checkedAt)}</span>
        </div>

        <h3 className="resource-title" title={resource.title}>
          {resource.title || resource.query || '未命名资源'}
        </h3>

        <div className="resource-meta">
          {resource.note ? <span className="resource-note">{resource.note}</span> : null}
          {resource.datetime ? <span>{resource.datetime}</span> : null}
          {resource.password ? <span className="password-chip">提取码 {resource.password}</span> : null}
          {resource.matchScore > 0 ? (
            <span className="match-chip">匹配度 {Math.round(resource.matchScore * 100)}%</span>
          ) : null}
        </div>

        <div className="resource-actions">
          {isQuark ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={resolve} disabled={resolving}>
              {resolving ? <Loader2 size={15} className="spin" /> : <Play size={15} fill="currentColor" />}
              {resolving ? '解析中…' : '解析播放'}
            </button>
          ) : isDirectVideo ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={resolve} disabled={resolving}>
              {resolving ? <Loader2 size={15} className="spin" /> : <Play size={15} fill="currentColor" />}
              播放直链
            </button>
          ) : null}

          <a className="btn btn-ghost btn-sm" href={resource.url} target="_blank" rel="noreferrer">
            <ExternalLink size={15} />
            打开链接
          </a>
          <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
            <Copy size={15} />
            复制
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={check} disabled={checking}>
            {checking ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
            检测
          </button>
          {resource.status === 'invalid' ? (
            <span className="resource-warning">
              <TriangleAlert size={14} />
              链接可能已失效
            </span>
          ) : null}
          {resource.status === 'valid' ? (
            <span className="resource-ok">
              <CheckCircle2 size={14} />
              可用
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}
