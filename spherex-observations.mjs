const archive = 'https://irsa.ipac.caltech.edu';
const maxRecords = 250;

// IRSA CSV quotes fields that contain commas, including product metadata.
function csvRows(csv) {
  return csv.trim().replace(/^\uFEFF/, '').split(/\r?\n/).map(line =>
    Array.from(line.matchAll(/(?:^|,)(?:"((?:[^"]|"")*)"|([^",]*))/g),
      ([, quoted, plain]) => quoted?.replaceAll('""', '"') ?? plain));
}

export function observationFrames(csv, ra, dec) {
  const [header, ...rows] = csvRows(csv);
  const columns = ['obs_id', 'energy_bandpassname', 't_min', 'access_url'];
  const indexes = columns.map(name => header.indexOf(name));
  if (indexes.some(index => index < 0)) throw new Error('Unexpected IRSA response');
  const frames = new Map();
  for (const row of rows) {
    const [id, detector, time, url] = indexes.map(index => row[index]);
    if (!id || !/^SPHEREx-D[1-6]$/.test(detector) || !time || !Number.isFinite(Number(time)) ||
        !url?.startsWith(archive + '/ibe/data/spherex/dr1/level2/') || !url.endsWith('.fits')) continue;
    const source = new URL(url);
    source.searchParams.set('center', ra + ',' + dec);
    source.searchParams.set('size', '0.1');
    frames.set(detector + ':' + id, { id, detector, mjd: Number(time), cutoutUrl: source.href });
  }
  const groups = new Map();
  for (const frame of frames.values()) {
    if (!groups.has(frame.detector)) groups.set(frame.detector, []);
    groups.get(frame.detector).push(frame);
  }
  const [group = []] = Array.from(groups.values()).sort((a, b) =>
    new Set(b.map(frame => Math.floor(frame.mjd))).size - new Set(a.map(frame => Math.floor(frame.mjd))).size ||
    b.length - a.length);
  const byDay = new Map();
  for (const frame of group.sort((a, b) => a.mjd - b.mjd)) {
    const day = Math.floor(frame.mjd);
    if (!byDay.has(day)) byDay.set(day, frame);
  }
  const dated = [...byDay.values()];
  return dated.length <= 8 ? dated : Array.from({length: 8}, (_, index) =>
    dated[Math.round(index * (dated.length - 1) / 7)]);
}

export async function serveObservations(url, response) {
  function send(status, body) {
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': status === 200 ? 'public, max-age=300' : 'no-store',
    }).end(JSON.stringify(body));
  }
  const coords = ['ra', 'dec'].map(name => url.searchParams.get(name));
  const [ra, dec] = coords.map(Number);
  if (coords.some(value => !value?.trim()) || !Number.isFinite(ra) || !Number.isFinite(dec) ||
      ra < 0 || ra >= 360 || dec < -90 || dec > 90) {
    send(400, { status: 'invalid_position' });
    return;
  }
  const query = new URL('/SIA', archive);
  query.search = new URLSearchParams({
    COLLECTION: 'spherex_dr1', POS: 'circle ' + ra + ' ' + dec + ' 0',
    MAXREC: String(maxRecords), RESPONSEFORMAT: 'CSV',
  });
  try {
    const upstream = await fetch(query, { signal: AbortSignal.timeout(8000) });
    if (!upstream.ok) throw new Error('IRSA HTTP ' + upstream.status);
    const frames = observationFrames(await upstream.text(), ra, dec);
    send(200, { status: frames.length ? 'ready' : 'empty', frames });
  } catch {
    send(502, { status: 'archive_unavailable', frames: [] });
  }
}
