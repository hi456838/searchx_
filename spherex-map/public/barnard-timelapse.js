const center = [269.44783234, 4.74805538];
const radius = 2 / 60;
const endpoint = '/timelapse/barnard-star/sequence';
const radians = degrees => degrees * Math.PI / 180;

function containsBarnard(ra, dec) {
  const dDec = Math.sin(radians(dec - center[1]) / 2);
  const dRa = Math.sin(radians(ra - center[0]) / 2);
  return dDec ** 2 + Math.cos(radians(dec)) * Math.cos(radians(center[1])) *
    dRa ** 2 <= Math.sin(radians(radius) / 2) ** 2;
}

export function setupBarnard(viewer, A, pointAt) {
  const byId = id => document.getElementById(id);
  const select = byId('barnard-select');
  const panel = byId('barnard-panel');
  const status = byId('barnard-status');
  const find = byId('barnard-find');
  const retry = byId('barnard-retry');
  const player = byId('barnard-player');
  const image = byId('barnard-image');
  const slider = byId('barnard-frame');
  const play = byId('barnard-play');
  const date = byId('barnard-date');
  const source = byId('barnard-source');
  const sky = byId('sky');
  const overlay = A.graphicOverlay({ name: 'Selected region', color: '#ffc779', lineWidth: 2 });
  viewer.addOverlay(overlay);
  let timer, pending, manifest, startPoint;
  let revision = 0;
  let frameRevision = 0;

  function stop() {
    clearInterval(timer);
    timer = undefined;
    play.textContent = 'Play';
  }

  function setSelecting(active) {
    select.setAttribute('aria-pressed', String(active));
    sky.classList.toggle('select-region', active);
  }

  function reset() {
    stop();
    revision++;
    frameRevision++;
    panel.hidden = false;
    player.hidden = true;
    image.removeAttribute('src');
    date.textContent = '';
    source.removeAttribute('href');
    retry.hidden = true;
    find.hidden = false;
  }

  async function showFrame(index) {
    const frame = manifest.frames[index];
    const request = ++frameRevision;
    slider.value = index;
    try {
      const next = new Image();
      next.src = frame.imageUrl;
      await next.decode();
      if (request !== frameRevision) return;
      image.src = frame.imageUrl;
      date.textContent = new Date(frame.observedAt).toISOString().slice(0, 10) + ' UTC';
      source.href = frame.sourceUrl;
    } catch {
      if (request !== frameRevision) return;
      stop();
      status.textContent = 'Could not load this observation. Try again.';
      retry.hidden = false;
    }
  }

  async function getSequence(progress) {
    let response = await fetch(endpoint, { method: 'POST', signal: AbortSignal.timeout(12000) });
    const deadline = Date.now() + 360000;
    while (true) {
      const result = await response.json();
      if (!response.ok || result.status !== 'running') return result;
      if (Date.now() >= deadline) throw new Error('Timed out waiting for IRSA');
      progress(result.message);
      await new Promise(resolve => setTimeout(resolve, 2000));
      response = await fetch(endpoint + '/' + encodeURIComponent(result.jobId), {
        signal: AbortSignal.timeout(12000),
      });
    }
  }

  async function load() {
    reset();
    const current = revision;
    status.textContent = 'Finding NEOWISE W1 observations at IRSA.';
    try {
      if (!manifest) {
        pending ??= getSequence(message => {
          if (!panel.hidden && status.dataset.loading === 'true') status.textContent = message;
        }).finally(() => { pending = undefined; });
        status.dataset.loading = 'true';
        const result = await pending;
        if (result.status === 'ready') manifest = result.manifest;
        if (current !== revision) return;
        if (result.status === 'insufficient') {
          status.textContent = result.message;
          return;
        }
        if (result.status !== 'ready') throw new Error('IRSA job failed');
      }
      if (current !== revision) return;
      status.textContent = '';
      slider.max = manifest.frames.length - 1;
      player.hidden = false;
      showFrame(0);
    } catch {
      if (current !== revision) return;
      status.textContent = 'Could not prepare the IRSA observations. Try again.';
      retry.hidden = false;
    } finally {
      if (current === revision) delete status.dataset.loading;
    }
  }

  select.addEventListener('click', () => {
    const active = select.getAttribute('aria-pressed') !== 'true';
    setSelecting(active);
    if (!active) return;
    reset();
    delete status.dataset.loading;
    status.textContent = 'Click or tap the sky to select a four-arcminute region.';
  });
  find.addEventListener('click', () => {
    pointAt(...center, .14);
    setSelecting(true);
    reset();
    delete status.dataset.loading;
    status.textContent = 'Click or tap the centre of the map to load the time-lapse.';
  });
  retry.addEventListener('click', load);
  byId('barnard-close').addEventListener('click', () => {
    reset();
    panel.hidden = true;
    delete status.dataset.loading;
    overlay.removeAll();
    setSelecting(false);
    select.focus();
  });
  sky.addEventListener('pointerdown', event => {
    startPoint = [event.clientX, event.clientY];
  }, true);
  sky.addEventListener('pointerup', event => {
    const point = startPoint;
    startPoint = undefined;
    if (!point || select.getAttribute('aria-pressed') !== 'true' ||
        Math.hypot(event.clientX - point[0], event.clientY - point[1]) > 6) return;
    const rect = sky.getBoundingClientRect();
    let coordinates;
    try {
      coordinates = viewer.pix2world(event.clientX - rect.left, event.clientY - rect.top, 'ICRS');
    } catch {
      return;
    }
    if (!coordinates?.every(Number.isFinite)) return;
    const [ra, dec] = coordinates;
    overlay.removeAll();
    overlay.add(A.circle(ra, dec, radius));
    if (containsBarnard(ra, dec)) {
      load();
    } else {
      reset();
      delete status.dataset.loading;
      status.textContent = 'Time-lapse is currently available for Barnard’s Star.';
    }
  }, true);

  slider.addEventListener('input', () => { stop(); showFrame(Number(slider.value)); });
  play.addEventListener('click', () => {
    if (timer) { stop(); return; }
    play.textContent = 'Pause';
    timer = setInterval(() => showFrame((Number(slider.value) + 1) % manifest.frames.length), 850);
  });
  select.disabled = false;
}
