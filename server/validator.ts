import { config } from './config.js';
import { smartFetch } from './direct-fetch.js';
import {
  listStaleResources,
  now,
  updateResourceCheck,
} from './db.js';
import { checkQuarkLink, parseQuarkShare } from './quark.js';
import { inspectMobileShare, parseMobileShare } from './mobile.js';
import { mapLimit } from './channels/shared.js';
import type { Resource } from './types.js';

export async function validateResource(resource: Resource): Promise<Resource> {
  let result: { status: Resource['status']; code: string; message: string };

  if (resource.cloudType === 'quark' || parseQuarkShare(resource.url)) {
    result = await checkQuarkLink(resource.url, resource.password);
  } else if (resource.cloudType === 'mobile' || parseMobileShare(resource.url, resource.password)) {
    result = await inspectMobileShare(resource.url, resource.password);
  } else if (resource.cloudType === 'magnet' || resource.cloudType === 'ed2k') {
    result = { status: 'unknown', code: 'p2p', message: '磁力/电驴链接不做在线可用性检测' };
  } else {
    result = await checkHttpLink(resource.url);
  }

  updateResourceCheck(resource.id, result.status, result.code, result.message);
  return { ...resource, status: result.status, statusCode: result.code, statusMessage: result.message, checkedAt: now() };
}

async function checkHttpLink(
  url: string,
): Promise<{ status: Resource['status']; code: string; message: string }> {
  const request = async (method: 'HEAD' | 'GET') => {
    const headers: Record<string, string> = {
      'User-Agent': config.userAgent,
      Accept: '*/*',
    };
    if (method === 'GET') headers.Range = 'bytes=0-0';
    return smartFetch(url, {
      method,
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
  };

  for (const method of ['HEAD', 'GET'] as const) {
    try {
      const response = await request(method);
      if (response.status >= 200 && response.status < 400) {
        return { status: 'valid', code: String(response.status), message: '可访问' };
      }
      if (response.status === 401 || response.status === 403) {
        return { status: 'locked', code: String(response.status), message: '需要登录或访问受限' };
      }
      if (response.status === 404 || response.status === 410) {
        return { status: 'invalid', code: String(response.status), message: '链接已失效' };
      }
      if (method === 'HEAD') continue;
      return { status: 'unknown', code: String(response.status), message: `HTTP ${response.status}` };
    } catch (error) {
      if (method === 'GET') {
        return {
          status: 'unknown',
          code: 'network',
          message: error instanceof Error ? error.message : '网络请求失败',
        };
      }
    }
  }
  return { status: 'unknown', code: '', message: '无法检测' };
}

export async function validateResources(resources: Resource[], concurrency = 4): Promise<{
  valid: number;
  invalid: number;
  locked: number;
  unknown: number;
}> {
  const counts = { valid: 0, invalid: 0, locked: 0, unknown: 0 };
  await mapLimit(resources, concurrency, async (resource) => {
    const checked = await validateResource(resource);
    counts[checked.status]++;
  });
  return counts;
}

export async function validateStaleResources(limit: number, staleHours: number): Promise<{
  checked: number;
  valid: number;
  invalid: number;
  locked: number;
  unknown: number;
}> {
  const stale = listStaleResources(limit, now() - Math.max(1, staleHours) * 3600);
  if (!stale.length) {
    return { checked: 0, valid: 0, invalid: 0, locked: 0, unknown: 0 };
  }
  const counts = await validateResources(stale, 4);
  return { checked: stale.length, ...counts };
}
