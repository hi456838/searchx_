import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const base = '/timelapse/barnard-star';

export async function serveBarnard(path, request, response) {
  const suffix = path.slice(base.length);
  const valid = (request.method === 'POST' && suffix === '/sequence') ||
    (request.method === 'GET' && /^\/(sequence\/barnard-neowise-w1-v1|frames\/0[0-6]\.png)$/.test(suffix));
  if (!valid) {
    response.writeHead(404).end();
    return;
  }
  try {
    const origin = process.env.BARNARD_WORKER_URL;
    if (!origin) throw new Error('BARNARD_WORKER_URL is unset');
    const upstream = await fetch(new URL(suffix, origin), {
      method: request.method,
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!upstream.ok) throw new Error('Worker HTTP ' + upstream.status);
    response.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json',
      'Cache-Control': upstream.headers.get('cache-control') || 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), response);
    else response.end();
  } catch (error) {
    console.warn('Barnard worker:', error.message);
    if (response.headersSent) {
      response.destroy();
      return;
    }
    response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ status: 'error', message: 'The time-lapse service is unavailable. Try again.' }));
  }
}
