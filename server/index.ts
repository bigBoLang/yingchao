import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { config } from './config.js';
import { bootstrapSettings, registerRoutes, registerStatic } from './routes.js';
import { startScheduler, stopScheduler } from './scheduler.js';
import { startPansou, stopPansou } from './services.js';
import { getServerPublicIp, lanRedirectUrl } from './lan.js';

const app = Fastify({
  logger: false,
  bodyLimit: 2 * 1024 * 1024,
  routerOptions: { maxParamLength: 4096 },
  trustProxy: true,
});

await app.register(cookie, {
  secret: config.appSecret || 'change-me-in-production',
  hook: 'onRequest',
  parseOptions: {},
});

bootstrapSettings();

await registerRoutes(app);
await registerStatic(app);

// 从公网域名访问、但人在家里时，自动切到局域网直连：
// 视频不再绕 Cloudflare，也不会有 HTTPS 页面加载 HTTP 视频的混合内容问题。
// 访问 https://域名/?lan=0 可关闭自动跳转（记一年）。
app.addHook('onRequest', async (request, reply) => {
  const rawUrl = request.raw.url || '';
  try {
    const lan = new URL(rawUrl, 'http://local').searchParams.get('lan');
    if (lan === '0') {
      reply.setCookie('yingchao_lan', 'off', {
        path: '/',
        maxAge: 365 * 24 * 60 * 60,
        sameSite: 'lax',
      });
    } else if (lan === '1') {
      reply.clearCookie('yingchao_lan', { path: '/' });
      if (request.cookies) delete request.cookies.yingchao_lan;
    }
  } catch {
    // 忽略非法 URL
  }
  const target = await lanRedirectUrl(request);
  if (target) {
    reply.header('Cache-Control', 'no-store');
    reply.redirect(target, 302);
  }
});

app.setErrorHandler((error: unknown, _request, reply) => {
  console.error('[server]', error);
  if (reply.sent) return;
  const err = error as { statusCode?: number; message?: string };
  reply.code(err.statusCode || 500).send({
    error: err.message || '服务器内部错误',
  });
});

try {
  await app.listen({ port: config.port, host: config.host });
  console.log('');
  console.log('  影巢 · CineNest');
  console.log(`  API:  http://${config.host}:${config.port}/api/health`);
  console.log(`  Web:  http://${config.host}:${config.port}`);
  console.log(`  数据: ${config.dataDir}`);
  console.log('');
  // 依赖服务异步启动，不阻塞 Web 服务对外提供页面。
  void startPansou();
  void getServerPublicIp();
  startScheduler();
} catch (error) {
  console.error('启动失败：', error);
  process.exit(1);
}

const shutdown = async () => {
  stopScheduler();
  await stopPansou();
  await app.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
