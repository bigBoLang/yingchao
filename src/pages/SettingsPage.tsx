import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Database,
  ExternalLink,
  HardDrive,
  Info,
  Loader2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  XCircle,
  Zap,
} from 'lucide-react';
import type {
  AdminOverview,
  Channel,
  Job,
  RuntimeSettings,
  SettingsResponse,
} from '../types';
import { api } from '../api';
import { useApi } from '../hooks/useApi';
import { useToast } from '../components/Toast';
import { ChannelModal, type ChannelPreset } from '../components/ChannelModal';
import { LoadingBlock } from '../components/EmptyState';
import { formatDate, relativeTime } from '../lib/format';

type Tab = 'channels' | 'cache' | 'player' | 'about';

const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: 'channels', label: '渠道管理', icon: <Server size={16} /> },
  { id: 'cache', label: '缓存与巡检', icon: <Database size={16} /> },
  { id: 'player', label: '播放器', icon: <Play size={16} /> },
  { id: 'about', label: '关于', icon: <Info size={16} /> },
];

export function SettingsPage() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('channels');
  const [editing, setEditing] = useState<Channel | null>(null);
  const [adding, setAdding] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [runningJob, setRunningJob] = useState<string | null>(null);
  const [cookieInput, setCookieInput] = useState('');
  const [savingCookie, setSavingCookie] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeSettings | null>(null);
  const [player, setPlayer] = useState<SettingsResponse['player'] | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const overview = useApi<AdminOverview>(() => api('/api/admin/overview'), []);
  const settings = useApi<SettingsResponse>(() => api('/api/settings'), []);
  const channelsApi = useApi<{ items: Channel[]; presets: ChannelPreset[] }>(
    () => api('/api/channels'),
    [],
  );

  useEffect(() => {
    if (settings.data?.runtime) setRuntime(settings.data.runtime);
    if (settings.data?.player) setPlayer(settings.data.player);
  }, [settings.data]);

  const reloadAll = () => {
    overview.reload();
    settings.reload();
    channelsApi.reload();
  };

  const toggleChannel = async (channel: Channel) => {
    try {
      await api(`/api/channels/${channel.id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !channel.enabled }),
      });
      toast.push(channel.enabled ? '渠道已停用' : '渠道已启用', 'success');
      reloadAll();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : '操作失败', 'error');
    }
  };

  const testChannel = async (channel: Channel) => {
    setTestingId(channel.id);
    try {
      const result = await api<{ ok: boolean; count: number; ms: number; message: string }>(
        `/api/channels/${channel.id}/test`,
        { method: 'POST' },
      );
      toast.push(
        `${channel.name}：${result.message}（${result.count} 条 / ${result.ms}ms）`,
        result.ok ? 'success' : 'error',
      );
      reloadAll();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : '测试失败', 'error');
    } finally {
      setTestingId(null);
    }
  };

  const deleteChannel = async (channel: Channel) => {
    if (!window.confirm(`确定删除渠道「${channel.name}」吗？`)) return;
    try {
      await api(`/api/channels/${channel.id}`, { method: 'DELETE' });
      toast.push('渠道已删除', 'success');
      reloadAll();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : '删除失败', 'error');
    }
  };

  const runJob = async (name: string) => {
    setRunningJob(name);
    try {
      const result = await api<{ ok: boolean; result: Record<string, unknown> }>('/api/admin/run', {
        method: 'POST',
        body: JSON.stringify({ job: name }),
      });
      const message = JSON.stringify(result.result);
      toast.push(`${name} 执行完成：${message}`, 'success');
      reloadAll();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : '任务执行失败', 'error');
    } finally {
      setRunningJob(null);
    }
  };

  const saveRuntime = async () => {
    if (!runtime) return;
    setSavingSettings(true);
    try {
      await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ runtime }),
      });
      toast.push('缓存与巡检设置已保存', 'success');
      settings.reload();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const saveCookie = async (value: string) => {
    setSavingCookie(true);
    try {
      await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ quarkCookie: value }),
      });
      toast.push(value ? '夸克 Cookie 已保存' : '夸克 Cookie 已清除', 'success');
      setCookieInput('');
      settings.reload();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setSavingCookie(false);
    }
  };

  const savePlayer = async () => {
    if (!player) return;
    setSavingSettings(true);
    try {
      await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ player }),
      });
      toast.push('播放器设置已保存', 'success');
      settings.reload();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  if (overview.loading && !overview.data) {
    return (
      <div className="container page">
        <LoadingBlock text="正在读取设置与缓存状态…" />
      </div>
    );
  }

  return (
    <div className="container page settings-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">CONTROL CENTER</span>
          <h1>设置</h1>
          <p>管理检索渠道、本地缓存、定期巡检与外部播放器。</p>
        </div>
        <div className="settings-status">
          <span className={`status-pill ${overview.data?.stats.enabledChannels ? 'ok' : 'warn'}`}>
            <Activity size={14} />
            {overview.data?.stats.enabledChannels || 0} 个渠道启用
          </span>
          <span className={`status-pill ${overview.data?.quarkCookieSet ? 'ok' : 'warn'}`}>
            <ShieldCheck size={14} />
            {overview.data?.quarkCookieSet ? '夸克 Cookie 已配置' : '未配置夸克 Cookie'}
          </span>
        </div>
      </header>

      <nav className="settings-tabs">
        {TABS.map((item) => (
          <button
            type="button"
            key={item.id}
            className={tab === item.id ? 'active' : ''}
            onClick={() => setTab(item.id)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>

      {tab === 'channels' ? (
        <section className="settings-section">
          <div className="settings-section-head">
            <div>
              <h2>检索渠道</h2>
              <p>搜索时会并发调用所有启用的渠道，结果按优先级、相关度和可用性排序。</p>
            </div>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
              <Plus size={16} />
              添加渠道
            </button>
          </div>

          <div className="channel-list">
            {(channelsApi.data?.items || []).map((channel) => (
              <article key={channel.id} className={`channel-card ${channel.enabled ? '' : 'disabled'}`}>
                <div className="channel-card-main">
                  <div className={`channel-type-icon type-${channel.type}`}>
                    {channel.type === 'http' ? <Server size={19} /> : <Sparkles size={19} />}
                  </div>
                  <div className="channel-card-info">
                    <div className="channel-title-row">
                      <h3>{channel.name}</h3>
                      <span className={`mini-badge type-${channel.type}`}>
                        {channel.type === 'pansou' ? 'PanSou' : channel.type === 'zhuyun' ? '竹云盘搜' : 'HTTP'}
                      </span>
                      <span className={`mini-badge ${channel.enabled ? 'on' : 'off'}`}>
                        {channel.enabled ? '启用' : '停用'}
                      </span>
                    </div>
                    <p className="channel-url">{channel.baseUrl || '未填写服务地址'}</p>
                    <div className="channel-meta">
                      <span>优先级 {channel.priority}</span>
                      <span>
                        {channel.lastOkAt ? `最近成功 ${relativeTime(channel.lastOkAt)}` : '尚未成功连接'}
                      </span>
                      {channel.lastError ? (
                        <span className="channel-error" title={channel.lastError}>
                          <AlertTriangle size={12} />
                          {channel.lastError.slice(0, 60)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="channel-card-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => testChannel(channel)}
                    disabled={testingId === channel.id}
                  >
                    {testingId === channel.id ? <Loader2 size={15} className="spin" /> : <Zap size={15} />}
                    测试
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(channel)}>
                    <Pencil size={15} />
                    编辑
                  </button>
                  <button
                    type="button"
                    className={`btn btn-ghost btn-sm ${channel.enabled ? '' : 'btn-accent'}`}
                    onClick={() => toggleChannel(channel)}
                  >
                    {channel.enabled ? '停用' : '启用'}
                  </button>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => deleteChannel(channel)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </article>
            ))}
            {!channelsApi.data?.items.length ? (
              <div className="inline-empty">还没有渠道，点击右上角添加 PanSou 或竹云盘搜。</div>
            ) : null}
          </div>

          <div className="settings-note">
            <Info size={16} />
            <p>
              PanSou 需要先自行部署（Docker：<code>ghcr.io/fish2018/pansou:latest</code>），默认地址为
              <code>http://localhost:8888</code>。竹云盘搜是公共节点，可能触发人机校验，建议作为备用。
            </p>
          </div>
        </section>
      ) : null}

      {tab === 'cache' ? (
        <section className="settings-section">
          <div className="settings-section-head">
            <div>
              <h2>缓存与巡检</h2>
              <p>热门影视的资源信息会写入本地 SQLite，后台任务会定期刷新并检测链接可用性。</p>
            </div>
          </div>

          <div className="stats-grid">
            <StatCard label="影视条目" value={overview.data?.stats.subjects || 0} icon={<Database size={17} />} />
            <StatCard label="缓存资源" value={overview.data?.stats.resources || 0} icon={<HardDrive size={17} />} />
            <StatCard label="有效链接" value={overview.data?.stats.validResources || 0} icon={<CheckCircle2 size={17} />} />
            <StatCard label="失效链接" value={overview.data?.stats.invalidResources || 0} icon={<XCircle size={17} />} />
            <StatCard label="检索记录" value={overview.data?.stats.searches || 0} icon={<Activity size={17} />} />
            <StatCard
              label="榜单更新"
              value={overview.data?.stats.lastCollectionUpdate ? relativeTime(overview.data.stats.lastCollectionUpdate) : '—'}
              icon={<RefreshCw size={17} />}
            />
          </div>

          <div className="job-grid">
            <JobCard
              title="刷新豆瓣榜单"
              description="拉取正在热映、热门剧集、Top250 等榜单，更新本地片库。"
              running={runningJob === 'collections'}
              onRun={() => runJob('collections')}
              icon={<RefreshCw size={18} />}
            />
            <JobCard
              title="刷新热门资源"
              description={`按浏览与热度挑选 ${runtime?.hotRefreshLimit || 12} 部作品，重新检索并缓存资源。`}
              running={runningJob === 'hot-resources'}
              onRun={() => runJob('hot-resources')}
              icon={<Sparkles size={18} />}
            />
            <JobCard
              title="巡检失效链接"
              description="批量检测缓存中的链接，标记失效或需要提取码的资源。"
              running={runningJob === 'validate'}
              onRun={() => runJob('validate')}
              icon={<ShieldCheck size={18} />}
            />
          </div>

          {runtime ? (
            <div className="settings-card">
              <div className="settings-card-head">
                <h3>任务参数</h3>
                <button type="button" className="btn btn-primary btn-sm" onClick={saveRuntime} disabled={savingSettings}>
                  {savingSettings ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
                  保存参数
                </button>
              </div>
              <div className="form-grid">
                <label>
                  <span>搜索结果缓存时长（小时）</span>
                  <input
                    type="number"
                    min={0}
                    value={runtime.searchCacheHours}
                    onChange={(event) => setRuntime({ ...runtime, searchCacheHours: Number(event.target.value) })}
                  />
                </label>
                <label>
                  <span>链接巡检间隔（小时）</span>
                  <input
                    type="number"
                    min={1}
                    value={runtime.validateHours}
                    onChange={(event) => setRuntime({ ...runtime, validateHours: Number(event.target.value) })}
                  />
                </label>
                <label>
                  <span>热门资源刷新间隔（小时）</span>
                  <input
                    type="number"
                    min={1}
                    value={runtime.hotRefreshHours}
                    onChange={(event) => setRuntime({ ...runtime, hotRefreshHours: Number(event.target.value) })}
                  />
                </label>
                <label>
                  <span>每轮刷新作品数</span>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={runtime.hotRefreshLimit}
                    onChange={(event) => setRuntime({ ...runtime, hotRefreshLimit: Number(event.target.value) })}
                  />
                </label>
                <label className="switch-label">
                  <span>启用后台自动任务</span>
                  <button
                    type="button"
                    className={`switch ${runtime.schedulerEnabled ? 'on' : ''}`}
                    onClick={() => setRuntime({ ...runtime, schedulerEnabled: !runtime.schedulerEnabled })}
                    aria-pressed={runtime.schedulerEnabled}
                  >
                    <span />
                  </button>
                </label>
              </div>
            </div>
          ) : null}

          <div className="settings-card">
            <div className="settings-card-head">
              <h3>最近任务</h3>
            </div>
            <div className="job-table">
              <div className="job-table-head">
                <span>任务</span>
                <span>状态</span>
                <span>开始时间</span>
                <span>耗时</span>
                <span>信息</span>
              </div>
              {(overview.data?.jobs || []).slice(0, 10).map((job) => (
                <JobRow key={job.id} job={job} />
              ))}
              {!overview.data?.jobs.length ? <div className="inline-empty">还没有任务记录。</div> : null}
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-head">
              <h3>榜单缓存</h3>
            </div>
            <div className="collection-grid">
              {(overview.data?.collections || []).map((collection) => (
                <div key={collection.key} className="collection-item">
                  <strong>{overview.data?.collectionDefs[collection.key]?.title || collection.key}</strong>
                  <span>{collection.count} 条 · {relativeTime(collection.updatedAt)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {tab === 'player' ? (
        <section className="settings-section">
          <div className="settings-section-head">
            <div>
              <h2>播放器</h2>
              <p>网盘视频会解析为直链，通过本机代理转发给浏览器或外部播放器。</p>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-head">
              <div>
                <h3>夸克 Cookie</h3>
                <p>搜索和链接有效性检测不需要 Cookie；解析网盘内文件、生成播放直链时需要。</p>
              </div>
              <span className={`status-pill ${settings.data?.quarkCookieSet ? 'ok' : 'warn'}`}>
                {settings.data?.quarkCookieSet ? '已配置' : '未配置'}
              </span>
            </div>
            <div className="cookie-row">
              <input
                type="password"
                value={cookieInput}
                onChange={(event) => setCookieInput(event.target.value)}
                placeholder={settings.data?.quarkCookieSet ? settings.data.quarkCookiePreview : '粘贴 pan.quark.cn 请求头中的 Cookie'}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => saveCookie(cookieInput)}
                disabled={savingCookie || !cookieInput.trim()}
              >
                {savingCookie ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
                保存
              </button>
              {settings.data?.quarkCookieSet ? (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => saveCookie('')}
                  disabled={savingCookie}
                >
                  清除
                </button>
              ) : null}
            </div>
            <ol className="cookie-steps">
              <li>在浏览器登录 <code>pan.quark.cn</code>，打开开发者工具。</li>
              <li>刷新页面，在 Network 里找任意 <code>drive-pc.quark.cn</code> 请求。</li>
              <li>复制请求头里的完整 Cookie，粘贴到上方保存。</li>
            </ol>
            <p className="form-note">
              Cookie 仅保存在本机 SQLite，不会上传。失效后解析会提示更新。
            </p>
          </div>

          {player ? (
            <div className="settings-card">
              <div className="settings-card-head">
                <div>
                  <h3>外部播放器</h3>
                  <p>在资源播放弹窗中显示对应的协议按钮。</p>
                </div>
                <button type="button" className="btn btn-primary btn-sm" onClick={savePlayer} disabled={savingSettings}>
                  {savingSettings ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
                  保存播放器
                </button>
              </div>
              <div className="player-pref-grid">
                {[
                  { key: 'iina' as const, label: 'IINA', desc: 'macOS，iina://weblink' },
                  { key: 'vlc' as const, label: 'VLC', desc: '跨平台，vlc:// 协议' },
                  { key: 'potplayer' as const, label: 'PotPlayer', desc: 'Windows，potplayer:// 协议' },
                  { key: 'mpv' as const, label: 'MPV', desc: '复制 mpv 命令到终端' },
                ].map((item) => (
                  <label key={item.key} className="check-card">
                    <input
                      type="checkbox"
                      checked={player[item.key]}
                      onChange={(event) => setPlayer({ ...player, [item.key]: event.target.checked })}
                    />
                    <div>
                      <strong>{item.label}</strong>
                      <span>{item.desc}</span>
                    </div>
                  </label>
                ))}
              </div>
              <div className="player-pref-grid">
                <h4 style={{gridColumn:'1/-1',margin:'8px 0 4px',fontSize:'0.9rem',color:'var(--muted)'}}>iOS / iPadOS</h4>
                {[
                  { key: 'infuse' as const, label: 'Infuse', desc: 'x-callback-url/play，支持 MKV/H.265/4K' },
                  { key: 'vlcIos' as const, label: 'VLC iOS', desc: 'vlc-x-callback://stream，免费开源' },
                  { key: 'nplayer' as const, label: 'nPlayer', desc: 'nplayer-https:// 协议，付费功能全' },
                ].map((item) => (
                  <label key={item.key} className="check-card">
                    <input
                      type="checkbox"
                      checked={player[item.key]}
                      onChange={(event) => setPlayer({ ...player, [item.key]: event.target.checked })}
                    />
                    <div>
                      <strong>{item.label}</strong>
                      <span>{item.desc}</span>
                    </div>
                  </label>
                ))}
              </div>
              <label className="form-inline">
                <span>默认外部播放器</span>
                <select
                  value={player.defaultExternal}
                  onChange={(event) => setPlayer({ ...player, defaultExternal: event.target.value })}
                >
                  <option value="iina">IINA</option>
                  <option value="vlc">VLC</option>
                  <option value="potplayer">PotPlayer</option>
                  <option value="mpv">MPV</option>
                  <option value="infuse">Infuse (iOS)</option>
                  <option value="vlcIos">VLC iOS</option>
                  <option value="nplayer">nPlayer</option>
                </select>
              </label>
              <div className="settings-note">
                <Info size={16} />
                <p>
                  播放地址形如 <code>http://127.0.0.1:8787/api/play/...</code>，带 Range 支持，可直接拖拽进度条。
                  外部播放器需要能访问本机地址；服务关闭后链接失效。
                </p>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === 'about' ? (
        <section className="settings-section">
          <div className="settings-section-head">
            <div>
              <span className="eyebrow">ABOUT</span>
              <h2>影巢 CineNest</h2>
              <p>一个把豆瓣影视元数据、网盘资源检索和本地缓存串起来的小站。</p>
            </div>
          </div>

          <div className="about-grid">
            <div className="settings-card">
              <h3>已经具备</h3>
              <ul className="feature-list">
                <li><CheckCircle2 size={15} />豆瓣正在热映、热门剧集、Top250 等榜单同步</li>
                <li><CheckCircle2 size={15} />按片名搜索豆瓣条目，详情页直接检索网盘</li>
                <li><CheckCircle2 size={15} />PanSou / 竹云盘搜 / 自定义 HTTP 三种渠道</li>
                <li><CheckCircle2 size={15} />夸克分享链接有效性检测</li>
                <li><CheckCircle2 size={15} />资源本地缓存、定时刷新与失效巡检</li>
                <li><CheckCircle2 size={15} />夸克文件解析 + 本机代理直链播放</li>
                <li><CheckCircle2 size={15} />IINA / VLC / PotPlayer / MPV 外部播放器</li>
              </ul>
            </div>
            <div className="settings-card">
              <h3>数据与合规</h3>
              <p className="about-text">
                影视元数据来自豆瓣公开页面接口，网盘链接来自用户配置的搜索渠道。本站不存储、不转存任何视频文件，
                只做搜索结果聚合与链接可用性检测。请尊重版权，仅将资源用于个人学习与交流。
              </p>
              <p className="about-text">
                夸克 Cookie 仅保存在本机数据库。对外部署时请加反向代理认证，并遵守所在地区法律法规。
              </p>
              <div className="about-links">
                <a href="https://github.com/fish2018/pansou" target="_blank" rel="noreferrer">
                  <ExternalLink size={14} /> PanSou 项目
                </a>
                <a href="https://movie.douban.com/" target="_blank" rel="noreferrer">
                  <ExternalLink size={14} /> 豆瓣电影
                </a>
              </div>
            </div>
            <div className="settings-card">
              <h3>运行信息</h3>
              <dl className="kv-list">
                <div><dt>版本</dt><dd>0.1.0</dd></div>
                <div><dt>数据目录</dt><dd>{settings.data?.config.dataDir || '—'}</dd></div>
                <div><dt>服务端口</dt><dd>{settings.data?.config.port || 8787}</dd></div>
                <div><dt>PanSou 默认地址</dt><dd>{settings.data?.config.pansouBaseUrl || '—'}</dd></div>
                <div><dt>竹云默认地址</dt><dd>{settings.data?.config.zhuyunBaseUrl || '—'}</dd></div>
                <div><dt>影视条目</dt><dd>{overview.data?.stats.subjects || 0}</dd></div>
                <div><dt>缓存资源</dt><dd>{overview.data?.stats.resources || 0}</dd></div>
              </dl>
            </div>
          </div>
        </section>
      ) : null}

      {adding ? (
        <ChannelModal
          presets={channelsApi.data?.presets || []}
          onClose={() => setAdding(false)}
          onSaved={reloadAll}
        />
      ) : null}
      {editing ? (
        <ChannelModal
          channel={editing}
          presets={channelsApi.data?.presets || []}
          onClose={() => setEditing(null)}
          onSaved={reloadAll}
        />
      ) : null}
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number | string; icon: React.ReactNode }) {
  return (
    <div className="stat-card">
      <span className="stat-card-icon">{icon}</span>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function JobCard({
  title,
  description,
  running,
  onRun,
  icon,
}: {
  title: string;
  description: string;
  running: boolean;
  onRun: () => void;
  icon: React.ReactNode;
}) {
  return (
    <div className="job-card">
      <span className="job-card-icon">{icon}</span>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onRun} disabled={running}>
        {running ? <Loader2 size={15} className="spin" /> : <Play size={15} />}
        {running ? '执行中…' : '立即执行'}
      </button>
    </div>
  );
}

function JobRow({ job }: { job: Job }) {
  const elapsed = job.finishedAt ? job.finishedAt - job.startedAt : Math.floor(Date.now() / 1000) - job.startedAt;
  return (
    <div className="job-row">
      <span className="job-name">
        {job.name === 'collections' ? '刷新榜单' : job.name === 'hot-resources' ? '热门资源' : job.name === 'validate' ? '链接巡检' : job.name}
      </span>
      <span className={`job-status ${job.status}`}>
        {job.status === 'ok' ? <CheckCircle2 size={13} /> : job.status === 'error' ? <XCircle size={13} /> : <Loader2 size={13} className="spin" />}
        {job.status === 'ok' ? '成功' : job.status === 'error' ? '失败' : '运行中'}
      </span>
      <span>{formatDate(job.startedAt)}</span>
      <span>{elapsed}s</span>
      <span className="job-message" title={job.message}>{job.message || '—'}</span>
    </div>
  );
}
