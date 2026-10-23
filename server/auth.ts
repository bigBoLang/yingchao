import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { config } from './config.js';

// 播放链接要交给 IINA / VLC / <video> 直接访问，图片代理要能被 <img> 引用，
// 它们无法携带登录信息，因此放在免登录白名单里（各自有 token 或域名白名单保护）。
const PUBLIC_PATHS = ['/api/health', '/api/play/', '/api/play-stats/', '/api/image'];

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function authEnabled(): boolean {
  return Boolean(config.authUser && config.authPass);
}

/**
 * 可选的 HTTP Basic 鉴权。配置 AUTH_USER + AUTH_PASS 后生效：
 * 浏览器首次访问会弹出登录框，之后同源请求和 <img> 都会自动带上凭证。
 */
export function registerAuth(app: FastifyInstance): void {
  if (!authEnabled()) return;
  app.addHook('onRequest', async (request, reply) => {
    const url = request.raw.url || '';
    if (PUBLIC_PATHS.some((prefix) => url.startsWith(prefix))) return;

    const header = request.headers.authorization || '';
    if (header.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const index = decoded.indexOf(':');
      const user = index >= 0 ? decoded.slice(0, index) : '';
      const pass = index >= 0 ? decoded.slice(index + 1) : '';
      if (safeEqual(user, config.authUser) && safeEqual(pass, config.authPass)) return;
    }

    reply.code(401).header('WWW-Authenticate', 'Basic realm="CineNest", charset="UTF-8"');
    return reply.send({ error: '需要登录后才能访问' });
  });
}
