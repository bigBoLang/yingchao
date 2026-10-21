# 影巢 · CineNest

豆瓣影视元数据 + 可插拔网盘资源检索。先用豆瓣了解一部片子，再去网盘里找能看的版本。

- **豆瓣目录**：首页榜单、分类浏览、条目详情、演员/类型/评分等元数据均来自豆瓣。
- **网盘检索**：默认接入 [PanSou](https://github.com/fish2018/pansou)，内置竹云盘搜备用渠道，也可以接入任意返回 JSON 的搜索 API。
- **本地缓存**：热门条目搜到的资源会写入 SQLite，定时巡检链接有效性，热门内容不必每次重新搜索。
- **外部播放**：夸克分享可解析出文件直链，通过带 Range 支持的本地代理播放；也可唤起 IINA、VLC、PotPlayer、MPV。

> 本项目只聚合公开的影视元数据与用户自行配置的搜索渠道，不存储、不传播任何影片文件。请仅将检索结果用于个人学习与已获授权的观看，遵守当地法律与网盘服务条款。

---

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 19、React Router 7、Vite 6、TypeScript |
| 后端 | Fastify 5、better-sqlite3、TypeScript |
| 打包 | Vite（Web）、tsup（Server） |
| 数据 | SQLite（元数据、资源、渠道、缓存、任务记录） |

## 快速开始

要求 Node.js 22+（推荐 22 LTS）。

```bash
npm install
cp .env.example .env    # 按需修改
npm run dev
```

- Web：<http://127.0.0.1:5173>（局域网：`http://<本机局域网 IP>:5173`）
- API：<http://127.0.0.1:8787/api/health>

`npm run dev` 会同时启动 Vite 和带热重载的 API；Vite 把 `/api` 代理到 8787。Vite 默认监听所有网卡，同一 Wi-Fi 下的手机、平板或电视可以直接打开局域网地址。服务没有登录鉴权，请不要暴露到公网。

生产模式：

```bash
npm run build
npm start
```

构建产物为 `dist/`（前端）和 `dist-server/`（后端），默认在 <http://127.0.0.1:8787> 同时提供页面与 API。

## 部署 PanSou（默认检索渠道）

PanSou 是一个开源的网盘聚合搜索服务，支持 Telegram 频道、插件和多种网盘。任选一种方式部署，默认监听 `8888`：

```bash
docker run -d --name pansou \
  -p 8888:8888 \
  -v pansou-data:/app/data \
  ghcr.io/fish2018/pansou:latest
```

或使用 Docker Compose：

```yaml
services:
  pansou:
    image: ghcr.io/fish2018/pansou:latest
    container_name: pansou
    ports:
      - "8888:8888"
    volumes:
      - pansou-data:/app/data
    restart: unless-stopped

volumes:
  pansou-data:
```

部署后打开 <http://localhost:8888> 确认服务正常，再回到影巢的「设置 → 渠道管理」点「测试」。如果 PanSou 不在本机，修改 `.env` 的 `PANSOU_BASE_URL`，或在渠道编辑里改地址。

> 默认只启用 Telegram 频道，覆盖有限。可以按 PanSou 文档用 `ENABLED_PLUGINS=pansearch,quarksoo,yunso,sousou` 启用公开索引插件，搜索结果会明显变多。

没有 Docker 时也可以从源码运行（需要 Go 1.25+）：

```bash
git clone --depth 1 https://github.com/fish2018/pansou.git
cd pansou
go build -o pansou .
ENABLED_PLUGINS=pansearch,quarksoo,yunso,sousou PORT=8888 ./pansou
```

## 配置

复制 `.env.example` 为 `.env`：

```ini
PORT=8787
# 0.0.0.0 允许局域网访问；只想本机使用可改为 127.0.0.1
HOST=0.0.0.0

# 数据目录，默认 ./data
# DATA_DIR=./data

# 默认渠道
PANSOU_BASE_URL=http://localhost:8888
ZHUYUN_BASE_URL=https://pan.zhuyunso.top
ENABLE_ZHUYUN=true

# 夸克 Cookie（可选，解析文件与播放时需要）
QUARK_COOKIE=

# 缓存与巡检
SEARCH_CACHE_HOURS=12
METADATA_CACHE_HOURS=24
COLLECTION_REFRESH_HOURS=6
HOT_REFRESH_HOURS=6
VALIDATE_HOURS=3
HOT_REFRESH_LIMIT=12
VALIDATE_BATCH=60
SCHEDULER_ENABLED=true

APP_SECRET=change-me-in-production
```

| 变量 | 说明 |
| --- | --- |
| `PORT` / `HOST` | 服务监听地址。默认 `0.0.0.0`，局域网设备可通过电脑 IP 访问；只想本机使用时改为 `127.0.0.1`。 |
| `DATA_DIR` | SQLite 与运行数据目录，默认 `./data`。 |
| `DB_PATH` | 单独指定数据库文件，优先级高于 `DATA_DIR`。 |
| `PANSOU_BASE_URL` | PanSou 实例地址，首次启动时写入默认渠道。 |
| `ZHUYUN_BASE_URL` / `ENABLE_ZHUYUN` | 竹云盘搜公共节点及是否作为内置渠道。 |
| `QUARK_COOKIE` | 夸克登录 Cookie。也可以稍后在设置页填写，设置页的值优先。 |
| `*_HOURS` / `*_LIMIT` / `*_BATCH` | 各类缓存与巡检周期。设置页可覆盖部分运行时值。 |
| `SCHEDULER_ENABLED` | 设为 `false` 会强制关闭所有定时任务（优先级高于设置页的开关）。 |
| `APP_SECRET` | 播放/图片代理链接的签名密钥。生产环境务必修改。 |
| `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` | 可选的服务端出站代理。公共搜索节点按出口 IP 风控时可走代理；本机 PanSou 通过 `NO_PROXY` 保持直连。 |

> 首次启动会自动创建表结构、写入默认渠道并抓取豆瓣榜单。抓取失败不会阻止服务启动，之后可在「设置 → 缓存与巡检」手动运行任务。

## 渠道

支持三种类型：

| 类型 | 说明 |
| --- | --- |
| `pansou` | PanSou 的 `POST /api/search` 接口，开箱即用。 |
| `zhuyun` | 竹云盘搜 SSE 接口，内置公共节点，可能被 WAF 限流。 |
| `http` | 通用 JSON API 适配器，通过字段映射接入任意搜索服务。 |

渠道可以在「设置 → 渠道管理」里增删改、启用/停用、调整优先级和测试连通性。搜索时会并发调用所有启用渠道，再按链接去重、相关度和可用性排序。

### 自定义 HTTP 渠道

`config` 示例：

```json
{
  "search": {
    "method": "GET",
    "url": "/api/search?kw={queryEncoded}",
    "headers": { "X-Api-Key": "your-key" },
    "body": null
  },
  "itemsPath": "data.list",
  "fields": {
    "title": "title",
    "url": "url",
    "password": "password",
    "cloudType": "cloud_type",
    "note": "note",
    "datetime": "datetime"
  },
  "cloudTypeMap": { "quark": "quark", "baidu": "baidu" },
  "maxResults": 50
}
```

- `search.url` 支持模板变量：`{query}`、`{queryEncoded}`、`{year}`、`{type}`、`{cloudType}`。相对路径会自动拼接渠道的 `baseUrl`。
- `search.method` 支持 `GET` / `POST` 等；`search.body` 可以是字符串或对象，对象会被 JSON 序列化。
- `itemsPath` 是结果数组的 JSON 路径（如 `data.list`）；留空表示响应根节点就是数组。
- `fields` 把业务字段映射到统一字段；`url` 为必填，其余可省略。
- `cloudTypeMap` 可把来源里的网盘类型名转换成 `quark` / `baidu` / `aliyun` / `xunlei` / `other`。
- `maxResults` 限制单渠道返回条数（最大 100）。

也可以直接调用 API：

```bash
curl -X POST http://127.0.0.1:8787/api/channels \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "我的搜索源",
    "type": "http",
    "baseUrl": "https://example.com",
    "enabled": true,
    "priority": 50,
    "config": {
      "search": { "method": "GET", "url": "/api/search?kw={queryEncoded}" },
      "itemsPath": "data.list",
      "fields": { "title": "title", "url": "url", "cloudType": "cloud_type" }
    }
  }'
```

## 夸克 Cookie 与播放

只做搜索和链接有效性检测不需要 Cookie。要让「播放」解析出分享里的具体文件，需要登录后的夸克 Cookie：

1. 浏览器登录 <https://pan.quark.cn>。
2. 打开开发者工具 → Network，任意找一个 `drive-pc.quark.cn` 请求。
3. 复制请求头里的完整 `Cookie`，粘贴到「设置 → 缓存与巡检 → 夸克 Cookie」，或写入 `.env` 的 `QUARK_COOKIE`。

播放流程：

1. 详情页选择一条夸克资源，点击解析。
2. 后端调用夸克接口换取分享 token、列出文件、取得下载直链。
3. 直链会封装成带签名的 `/api/play/:token` 地址，支持 HTTP Range，可拖动进度条。
4. 也可以选择用 IINA / VLC / PotPlayer / MPV 打开同一个代理地址。

非夸克网盘或未配置 Cookie 时，仍可复制分享链接到对应 App 打开。Cookie 只保存在本地 SQLite，不会上传到第三方。

## 定时任务与缓存

| 任务 | 默认周期 | 作用 |
| --- | --- | --- |
| `collections` | 6 小时 | 刷新豆瓣首页榜单与条目元数据。 |
| `hot-resources` | 6 小时 | 为热门且已有检索记录的条目刷新资源；至少有一个渠道近 7 天成功过才会执行。 |
| `validate` | 3 小时 | 巡检过期资源链接；失效链接会重试，连续失败 5 次才标记为失效。 |

设置页可以手动运行任务、查看最近任务记录、调整缓存时长与巡检批量。资源搜索结果默认缓存 12 小时；同一链接在多个渠道出现时会去重并保留信息更完整的一条。

## 常用脚本

```bash
npm run dev          # 同时启动 API 与 Vite
npm run dev:server   # 只启动 API（tsx watch）
npm run dev:web      # 只启动 Vite
npm run typecheck    # 前后端 TypeScript 检查
npm run build        # 构建 dist + dist-server
npm start            # 运行生产构建
```

## API 速览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET | `/api/home` | 首页榜单、Hero、统计 |
| GET | `/api/subjects` | 分类浏览（`type`、`genre`、`sort`、`page`） |
| GET | `/api/subjects/:id` | 条目详情、资源、检索状态 |
| POST | `/api/subjects/:id/search` | 触发该条目的网盘检索 |
| GET | `/api/search?q=` | 豆瓣条目搜索（失败时回退本地缓存） |
| GET/POST | `/api/channels` | 渠道列表 / 新建 |
| PUT/DELETE | `/api/channels/:id` | 修改 / 删除渠道 |
| POST | `/api/channels/:id/test` | 测试渠道 |
| GET/PUT | `/api/settings` | 夸克 Cookie、播放器偏好、运行时设置 |
| GET | `/api/admin/overview` | 统计、任务、榜单、渠道总览 |
| POST | `/api/admin/run` | 手动运行 `collections` / `hot-resources` / `validate` |
| POST | `/api/resources/:id/check` | 立即检测单条资源 |
| POST | `/api/resources/:id/resolve` | 解析夸克分享或视频直链 |
| GET | `/api/image?url=` | 豆瓣图片代理（绕开防盗链） |
| GET | `/api/play/:token` | 带签名的播放代理，支持 Range |

## 目录结构

```text
server/
  index.ts          Fastify 启动、静态资源、优雅退出
  routes.ts         API 路由、播放/图片代理、SPA 回退
  config.ts         环境变量
  db.ts             SQLite 表结构、仓储、设置、任务
  douban.ts         豆瓣榜单/搜索/详情
  quark.ts          夸克 token、文件列表、直链、签名
  validator.ts      资源有效性检测
  scheduler.ts      定时任务
  channels/         pansou / zhuyun / http 适配器
  services/search.ts 检索、去重、持久化
src/
  pages/            Home / Browse / Search / Detail / Settings
  components/       ResourcePanel、PlayerModal、卡片、导航等
  styles.css        深色影院风格与响应式布局
data/               SQLite（首次启动生成，已在 .gitignore 中）
```

## 常见问题

**竹云盘搜返回 HTTP 468 / WAF 验证页**

公共节点会按 IP、频率和地区触发 SafeLine 人机验证。影巢会把错误显示在渠道状态里，但不会尝试绕过验证。可以稍后重试、换网络，或改用自建 PanSou / 自定义渠道。

**豆瓣搜索提示需要登录**

豆瓣新版 `/v2/search` 需要登录，本项目改用 `movie.douban.com/j/subject_suggest`，无需账号。若豆瓣整体不可用，搜索会回退到本地已缓存的条目。

**夸克解析提示 Cookie 无效或未配置**

确认 Cookie 来自已登录的 `pan.quark.cn` 会话，且没有过期。Cookie 只需放在本地；如果服务部署在公网，请务必设置访问控制，避免他人使用你的网盘账号。

**首次播放较慢，或提示容量不足**

夸克分享里的文件不能直接取下载直链。影巢会先把当前选中的一个文件转存到你自己的网盘「影巢播放缓存」目录，再生成播放直链。首次播放需要几秒并占用网盘容量；同一文件再次播放会直接复用。免费账号的大文件下载限制已通过桌面客户端 UA 处理。播放结束后可在夸克网盘里手动清理这个目录。

**局域网其他设备打不开**

确认设备与电脑在同一 Wi-Fi，且 `.env` 为 `HOST=0.0.0.0`。开发模式访问 `http://<电脑 IP>:5173`，生产模式访问 `http://<电脑 IP>:8787`。macOS 首次运行可能弹出防火墙提示，需要允许 Node 接受传入连接。本服务没有登录鉴权，局域网内任何人都能使用你的夸克 Cookie，请只在可信网络开启。

**播放地址 404 或签名失效**

播放链接由 `APP_SECRET` 签发并带有效期。修改密钥或重启后旧链接会失效，重新解析即可。反向代理需要放行 `Range` 请求头并关闭对响应体的缓冲，否则无法拖动进度。

**端口被占用**

改 `.env` 的 `PORT`；如果同时改了 API 端口，记得同步修改 `vite.config.ts` 里 `/api` 的代理目标。

## 生产部署建议

- 用 `HOST=0.0.0.0` 监听，前置 Nginx/Caddy 处理 TLS 与访问控制。
- 设置强随机 `APP_SECRET`，不要把 `.env` 和 `data/` 提交到版本库。
- 反向代理对 `/api/play/` 关闭缓冲并透传 `Range`，否则大文件播放会卡顿。
- SQLite 适合单机与个人使用；多实例部署需要换成共享数据库或把检索缓存独立出去。
- 豆瓣与网盘接口都可能限流，建议保留默认的缓存与巡检周期，不要高频轮询。

## 许可与声明

本项目仅用于个人学习和技术研究。豆瓣元数据版权归豆瓣及相应权利人所有；网盘资源由各渠道和用户自行提供。请勿将本项目用于商业分发、批量抓取或侵犯版权的内容传播。
