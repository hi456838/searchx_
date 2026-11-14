import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const base = '/timelapse/barnard-star';
const previews = [
  ['2014-03-20T22:48:31.238Z', '1b/47161b/108/47161b108-w1-int-1b.fits',
    new URL('../spherex-map/public/barnard-preview/00.png', import.meta.url)],
  ['2018-08-31T19:17:16.966Z', '5a/96725a/160/96725a160-w1-int-1b.fits',
    new URL('../spherex-map/public/barnard-preview/01.png', import.meta.url)],
];

async function servePreview(suffix, response) {
  const image = suffix.match(/^\/preview\/(0[01])\.png$/);
  if (image) {
    const bytes = await readFile(previews[Number(image[1])][2]);
    response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
    response.end(bytes);
    return true;
  }
  if (!suffix.startsWith('/sequence')) return false;
  response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify({
    status: 'ready',
    manifest: {
      preview: true,
      frames: previews.map(([observedAt, source], index) => ({
        observedAt,
        imageUrl: base + '/preview/0' + index + '.png',
        sourceUrl: 'https://irsa.ipac.caltech.edu/ibe/data/wise/neowiser/p1bm_frm/' + source,
      })),
    },
  }));
  return true;
}

export async function serveBarnard(path, request, response) {
  const suffix = path.slice(base.length);
  if (request.method === 'GET' && /^\/preview\/0[01]\.png$/.test(suffix)) {
    await servePreview(suffix, response);
    return;
  }
  const valid = (request.method === 'POST' && suffix === '/sequence') ||
    (request.method === 'GET' && /^\/(sequence\/barnard-neowise-w1-v1|frames\/0[0-6]\.png)$/.test(suffix));
  if (!valid) {
    response.writeHead(404).end();
    return;
  }
  try {
    const origin = process.env.BARNARD_WORKER_URL;
    if (!origin && await servePreview(suffix, response)) return;
    if (!origin) throw new Error('BARNARD_WORKER_URL is unset');
    const upstream = await fetch(new URL(suffix, origin), {
      method: request.method,
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!upstream.ok) throw new Error('Worker HTTP ' + upstream.status);
    if (suffix.startsWith('/sequence')) {
      const result = await upstream.json();
      if (result.status === 'error' && await servePreview(suffix, response)) return;
      response.writeHead(upstream.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(result));
      return;
    }
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
    if (await servePreview(suffix, response)) return;
    response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ status: 'error', message: 'The time-lapse service is unavailable. Try again.' }));
  }
}
