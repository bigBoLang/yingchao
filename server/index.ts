import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { config } from './config.js';
import { bootstrapSettings, registerRoutes, registerStatic } from './routes.js';
import { startScheduler, stopScheduler } from './scheduler.js';

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
  startScheduler();
} catch (error) {
  console.error('启动失败：', error);
  process.exit(1);
}

const shutdown = async () => {
  stopScheduler();
  await app.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
