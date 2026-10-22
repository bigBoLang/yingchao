# 影巢 CineNest

> 豆瓣元数据 + 可插拔网盘检索 + 本地缓存 + 多端播放

![首页](docs/screenshots/home.png)

## ✨ 核心功能

- **豆瓣同步**：正在热映、Top250、热门剧集、分类浏览
- **多渠道检索**：PanSou（默认）、竹云盘搜、自定义 HTTP API
- **夸克 / 移动云盘原生播放**：
  - 夸克：转存 → 多分片并发拉流 → 代理直链，**4K 原盘 20+ MB/s**
  - 移动云盘：HLS 代理重写 → 浏览器 / IINA / VLC 直接播
- **资源智能排序**：可用优先 → 匹配度 → 最近见过，前 3 条折叠展开
- **全平台外部播放器**：

| 平台 | 推荐 | 支持列表 |
|------|------|----------|
| macOS | IINA | IINA / VLC / MPV |
| Windows | PotPlayer | PotPlayer / VLC / MPV |
| iOS | Infuse | Infuse / VLC / nPlayer |
| Android | MX Player | MX Player / VLC / KMPlayer |

- **用户系统**：JWT + HttpOnly Cookie，保护设置/渠道/管理接口
- **Cloudflare Tunnel**：零公网 IP、自动 HTTPS、可加 Access 认证

## 🚀 快速开始

```bash
git clone https://github.com/bigBoLang/yingchao.git
cd yingchao
cp .env.example .env   # 填 QUARK_COOKIE / APP_SECRET
npm install
npm run build
npm start              # http://localhost:8787
```

### 局域网 / 公网访问

```bash
# 开发模式
HOST=0.0.0.0 npm run dev

# 生产 + Cloudflare Tunnel（临时域名）
cloudflared tunnel --url http://localhost:8787
# → https://xxx.trycloudflare.com

# 固定域名：把域名 NS 改到 Cloudflare，建 Named Tunnel + DNS 路由
```

## 📸 界面预览

| 首页 | 详情页资源列表 |
|------|----------------|
| ![home](docs/screenshots/home.png) | ![detail](docs/screenshots/detail-resources.jpg) |

| 播放弹窗（外部播放器） | 设置-播放器 |
|------------------------|-------------|
| ![player](docs/screenshots/player-modal.png) | ![settings-player](docs/screenshots/settings-player.png) |

| 设置-渠道管理 | 移动端播放器 |
|---------------|--------------|
| ![settings-channels](docs/screenshots/settings-channels.png) | ![mobile](docs/screenshots/mobile-player.png) |

## 🎬 4K 原盘播放演示

> 夸克分享 60GB MKV → 转存 → 4 路并发拉流 → **IINA / VLC 硬解 4K HDR**

![4k](docs/screenshots/4k-playback.png)

## ⚙️ 配置说明

| 环境变量 | 说明 |
|----------|------|
| `QUARK_COOKIE` | 夸克登录 Cookie（设置页也可填） |
| `APP_SECRET` | JWT 签名密钥，**生产环境必改** |
| `HOST=0.0.0.0` | 局域网访问 |
| `PORT=8787` | 服务端口 |

## 🔐 安全提醒

- Cookie 仅存在本机 SQLite，**绝不上传**
- 服务无鉴权，**仅在可信网络**或配合 Cloudflare Access 使用
- 多地同时播放大文件易触发夸克风控，建议配合 Access 限制访问

## 📄 License

MIT