import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export async function serveRegion(url, request, response) {
  const path = url.pathname.replace(/^\/timelapse/, '');
  const start = request.method === 'POST' && path === '/regions';
  if (!start && !(request.method === 'GET' &&
      /^\/regions\/[a-f0-9]{32}(?:\/frames\/[0-9]{5}[a-z][0-9]{3}-w1\.png)?$/.test(path))) {
    response.writeHead(404).end();
    return;
  }

  const params = new URLSearchParams();
  if (start) {
    for (const [key, min, max] of [['ra', 0, 360], ['dec', -90, 90], ['field', 2, 6]]) {
      const raw = url.searchParams.get(key) ?? (key === 'field' ? '4' : '');
      const number = Number(raw);
      if (!raw.trim() || !Number.isFinite(number) || number < min || number > max ||
          (key === 'ra' && number === max)) {
        response.writeHead(422).end();
        return;
      }
      params.set(key, String(number));
    }
  }

  try {
    const upstream = new URL(path, process.env.BARNARD_WORKER_URL);
    upstream.search = params;
    const result = await fetch(upstream, {
      method: request.method, redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    response.writeHead(result.status, {
      'Content-Type': result.headers.get('content-type') || 'application/json',
      'Cache-Control': result.headers.get('cache-control') || 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    if (result.body) await pipeline(Readable.fromWeb(result.body), response);
    else response.end();
  } catch (error) {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    console.warn('Region worker:', error.message);
    response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ message: 'The time-lapse service is unavailable. Try again.' }));
  }
}
