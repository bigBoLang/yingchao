import { useMemo, useState } from 'react';
import { Loader2, Save, Server, Sparkles } from 'lucide-react';
import type { Channel, ChannelType } from '../types';
import { api } from '../api';
import { Modal } from './Modal';
import { useToast } from './Toast';

export interface ChannelPreset {
  type: ChannelType;
  name: string;
  baseUrl: string;
  description: string;
  config: Record<string, unknown>;
}

const TYPE_LABELS: Record<ChannelType, string> = {
  pansou: 'PanSou',
  zhuyun: '竹云盘搜',
  http: '自定义 HTTP',
  quarkpanso: 'QuarkPanSo',
  yunso: '小云搜索',
  panws: '盘万搜',
};

const BASE_URL_PLACEHOLDERS: Record<ChannelType, string> = {
  pansou: 'http://localhost:8888',
  zhuyun: 'https://pan.zhuyunso.top',
  http: 'https://example.com',
  quarkpanso: 'https://www.quarkpanso.com',
  yunso: 'https://www.yunso.net',
  panws: 'https://panws.net',
};

const BASE_URL_HINTS: Record<ChannelType, string> = {
  pansou: 'PanSou 服务根地址，不需要带 /api/search。',
  zhuyun: '竹云盘搜节点地址。公共节点可能触发人机校验。',
  http: '自定义接口的根地址，可在下方配置相对路径。',
  quarkpanso: 'QuarkPanSo 站点根地址；公共接口有频控，建议保留默认地址。',
  yunso: '小云搜索站点根地址，使用其公开 opensearch 接口。',
  panws: '盘万搜站点根地址，直接解析服务端渲染的搜索页。',
};

export function ChannelModal({
  channel,
  presets,
  onClose,
  onSaved,
}: {
  channel?: Channel;
  presets: ChannelPreset[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [type, setType] = useState<ChannelType>(channel?.type || 'pansou');
  const [name, setName] = useState(channel?.name || '');
  const [baseUrl, setBaseUrl] = useState(channel?.baseUrl || '');
  const [priority, setPriority] = useState(channel?.priority ?? 100);
  const [enabled, setEnabled] = useState(channel?.enabled ?? true);
  const [configText, setConfigText] = useState(
    JSON.stringify(channel?.config || presets[0]?.config || {}, null, 2),
  );
  const [saving, setSaving] = useState(false);
  const [showPresets, setShowPresets] = useState(!channel);

  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.type === type),
    [presets, type],
  );

  const applyPreset = (preset: ChannelPreset) => {
    setType(preset.type);
    setName(preset.name);
    setBaseUrl(preset.baseUrl);
    setConfigText(JSON.stringify(preset.config, null, 2));
    setShowPresets(false);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      toast.push('请填写渠道名称', 'error');
      return;
    }
    let config: Record<string, unknown>;
    try {
      config = configText.trim() ? (JSON.parse(configText) as Record<string, unknown>) : {};
    } catch {
      toast.push('高级配置不是合法的 JSON', 'error');
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        type,
        baseUrl: baseUrl.trim(),
        priority: Number(priority) || 100,
        enabled,
        config,
      };
      if (channel) {
        await api(`/api/channels/${channel.id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        toast.push('渠道已更新', 'success');
      } else {
        await api('/api/channels', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        toast.push('渠道已添加', 'success');
      }
      onSaved();
      onClose();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={channel ? '编辑渠道' : '添加检索渠道'}
      subtitle="渠道可以是 PanSou、竹云盘搜、公共网盘搜索，也可以是任意返回 JSON 的搜索 API"
      onClose={onClose}
      wide
      footer={
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>取消</button>
          <button type="submit" form="channel-form" className="btn btn-primary" disabled={saving}>
            {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
            {saving ? '保存中…' : '保存渠道'}
          </button>
        </div>
      }
    >
      <form id="channel-form" onSubmit={submit} className="channel-form">
        {showPresets && !channel ? (
          <div className="preset-grid">
            {presets.map((preset) => (
              <button
                type="button"
                key={`${preset.type}-${preset.name}`}
                className="preset-card"
                onClick={() => applyPreset(preset)}
              >
                <span className="preset-icon">
                  {preset.type === 'http' ? <Server size={18} /> : <Sparkles size={18} />}
                </span>
                <strong>{preset.name}</strong>
                <p>{preset.description}</p>
                <em>{TYPE_LABELS[preset.type]}</em>
              </button>
            ))}
          </div>
        ) : null}

        <div className="form-grid">
          <label>
            <span>渠道类型</span>
            <select value={type} onChange={(event) => setType(event.target.value as ChannelType)}>
              {(Object.keys(TYPE_LABELS) as ChannelType[]).map((value) => (
                <option key={value} value={value}>
                  {TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>渠道名称</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：我的 PanSou" />
          </label>
          <label className="span-2">
            <span>服务地址</span>
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={BASE_URL_PLACEHOLDERS[type]}
            />
            <small>{BASE_URL_HINTS[type]}</small>
          </label>
          <label>
            <span>优先级</span>
            <input
              type="number"
              min={1}
              max={999}
              value={priority}
              onChange={(event) => setPriority(Number(event.target.value))}
            />
            <small>数字越小越优先，用于结果排序与展示。</small>
          </label>
          <label className="switch-label">
            <span>启用渠道</span>
            <button
              type="button"
              className={`switch ${enabled ? 'on' : ''}`}
              onClick={() => setEnabled((value) => !value)}
              aria-pressed={enabled}
            >
              <span />
            </button>
          </label>
        </div>

        <label className="config-field">
          <span>高级配置（JSON）</span>
          <textarea
            value={configText}
            onChange={(event) => setConfigText(event.target.value)}
            rows={10}
            spellCheck={false}
          />
          <small>
            {type === 'zhuyun'
              ? 'maxDecode 控制每次最多解析多少条链接，timeoutMs 控制 SSE 读取时长。'
              : type === 'quarkpanso'
                ? 'size 控制返回条数，minIntervalMs 控制请求间隔（默认 60000 毫秒）；频控期间会自动跳过。'
                : type === 'yunso' || type === 'panws'
                  ? 'maxResults 控制最多保留多少条结果，timeoutMs 控制请求超时。'
                  : type === 'pansou'
                    ? '可配置 apiKey、headers、channels、plugins、onlyCloudTypes、searchPath 等；留空即可。'
                    : 'search.url 支持 {query}、{queryEncoded}、{year} 占位符；itemsPath 指向结果数组；fields 做字段映射。'}
          </small>
        </label>

        {selectedPreset && !channel ? (
          <p className="form-note">{selectedPreset.description}</p>
        ) : null}
      </form>
    </Modal>
  );
}
