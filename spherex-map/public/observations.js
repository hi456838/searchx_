export function setupObservations(viewer, A, selectTimeLapse, nearbyObject, prefetchTimeLapse) {
  const byId = id => document.getElementById(id);
  const sky = byId('sky');
  const panel = byId('observation-panel');
  const position = byId('observation-position');
  const status = byId('observation-status');
  const player = byId('observation-player');
  const slider = byId('observation-frame');
  const play = byId('observation-play');
  const cutout = byId('observation-source');
  const overlay = A.graphicOverlay({ name: 'SPHEREx observation position', color: '#8eeade', lineWidth: 2 });
  viewer.addOverlay(overlay);
  let gesture, request, timer, selected, frames = [];
  let hoverTimer;

  function stop() {
    clearInterval(timer);
    timer = undefined;
    play.textContent = 'Play';
  }

  function showFrame(index) {
    const frame = frames[index];
    slider.value = index;
    const date = new Date((frame.mjd - 40587) * 86400000);
    byId('observation-date').textContent = date.toISOString().slice(0, 10) +
      ' · MJD ' + frame.mjd.toFixed(4) + ' · ' + frame.detector;
    cutout.href = frame.cutoutUrl;
  }

  async function select(ra, dec) {
    if (![ra, dec].every(Number.isFinite)) return;
    if (byId('barnard-select').getAttribute('aria-pressed') === 'true') return;
    request?.abort();
    const current = new AbortController();
    request = current;
    selected = [ra, dec];
    stop();
    panel.hidden = false;
    player.hidden = true;
    overlay.removeAll();
    overlay.add(A.circle(ra, dec, .05));
    position.textContent = 'RA ' + ra.toFixed(4) + '° · Dec ' + dec.toFixed(4) + '°';
    status.textContent = 'Looking for SPHEREx DR1 observations…';
    byId('observation-retry').hidden = true;
    const query = new URLSearchParams({ ra: ra.toFixed(6), dec: dec.toFixed(6) });
    try {
      const response = await fetch('/spherex-observations?' + query, { signal: current.signal });
      if (!response.ok) throw new Error('Archive unavailable');
      const results = await response.json();
      if (current.signal.aborted) return;
      frames = results.frames;
      if (!frames.length) {
        status.textContent = 'No matching DR1 wide-survey exposures found at this position.';
        return;
      }
      status.textContent = frames.length === 1 ? 'One observation date found.' :
        frames.length + ' observation dates from the same detector.';
      slider.max = frames.length - 1;
      slider.disabled = play.disabled = frames.length < 2;
      showFrame(0);
      player.hidden = false;
    } catch {
      if (current.signal.aborted) return;
      status.textContent = 'IRSA couldn’t return observations. Try again or choose another spot.';
      byId('observation-retry').hidden = false;
    }
  }

  function coordinatesAt(x, y) {
    const rect = sky.getBoundingClientRect();
    try {
      return viewer.pix2world(x - rect.left, y - rect.top, 'ICRS');
    } catch {
      return null;
    }
  }

  sky.addEventListener('pointerleave', () => clearTimeout(hoverTimer));
  sky.addEventListener('pointerdown', event => {
    clearTimeout(hoverTimer);
    if (!event.isPrimary || event.button !== 0 ||
        event.target.closest('button, a, input, select, .aladin-control-container')) {
      gesture = undefined;
      return;
    }
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }, true);
  sky.addEventListener('pointermove', event => {
    clearTimeout(hoverTimer);
    if (event.pointerType === 'mouse' && !event.buttons &&
        !event.target.closest('button, a, input, select, .aladin-control-container')) {
      const { clientX, clientY } = event;
      hoverTimer = setTimeout(() => {
        if (!nearbyObject(clientX, clientY)) return;
        const coords = coordinatesAt(clientX, clientY);
        if (coords) prefetchTimeLapse(...coords);
      }, 700);
    }
    if (gesture && (gesture.id !== event.pointerId ||
        Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 6)) gesture = undefined;
  }, true);
  sky.addEventListener('pointercancel', () => { gesture = undefined; }, true);
  sky.addEventListener('pointerup', event => {
    const start = gesture;
    gesture = undefined;
    if (start?.id !== event.pointerId || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) return;
    const coords = coordinatesAt(event.clientX, event.clientY);
    if (coords && byId('barnard-select').getAttribute('aria-pressed') !== 'true') void selectTimeLapse(...coords);
  }, true);
  byId('observation-close').addEventListener('click', () => {
    request?.abort();
    stop();
    overlay.removeAll();
    panel.hidden = true;
    byId('observation-center').focus();
  });
  byId('observation-retry').addEventListener('click', () => { if (selected) void select(...selected); });
  byId('barnard-select').addEventListener('click', () => {
    if (!panel.hidden && byId('barnard-select').getAttribute('aria-pressed') === 'true') {
      request?.abort();
      stop();
      overlay.removeAll();
      panel.hidden = true;
    }
  });
  byId('observation-center').addEventListener('click', () => { void select(...viewer.getRaDec()); });
  byId('observation-center').disabled = false;
  slider.addEventListener('input', () => { stop(); showFrame(Number(slider.value)); });
  play.addEventListener('click', () => {
    if (timer) return stop();
    play.textContent = 'Pause';
    timer = setInterval(() => showFrame((Number(slider.value) + 1) % frames.length), 1000);
  });

  select.close = () => { request?.abort(); stop(); overlay.removeAll(); panel.hidden = true; };
  return select;
}
