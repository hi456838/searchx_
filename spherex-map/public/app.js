import { coordinates, parseProperties, references } from './sky-data.js';

import { barnardMarker, setupBarnard } from './barnard-timelapse.js';

const byId = id => document.getElementById(id);
const channel = byId('channel');
const survey = byId('survey');
const opticalUrl = 'https://irsa.ipac.caltech.edu/data/hips/CDS/DSS2/color';
const notice = byId('notice');
const target = byId('target');
const returnButton = byId('home');
const blankFrames = new Set([50, 51]);
const home = references[0];
const loadedFrames = new Set();
let viewer, A, layer;
let selectedReference;
let activeFrame = 62;
let searchRevision = 0;
let loadDeadline;
let lastTarget = { ...home, label: 'Horsehead' };

function showNotice(message, blank = false) {
  notice.textContent = message;
  notice.hidden = !message;
  notice.toggleAttribute('data-blank', blank);
}

function showNavigationStatus(message) {
  const status = byId('navigation-status');
  status.textContent = message;
  status.hidden = !message;
}

const positionText = (ra, dec) => `RA ${ra.toFixed(4)}° · Dec ${dec.toFixed(4)}°`;
function updatePosition() {
  byId('position').textContent = positionText(...viewer.getRaDec());
}

function inspect(reference) {
  if (reference) byId("guide").open = false;

  selectedReference = reference;
  byId('inspector').hidden = !reference;
  for (const pin of byId('map-pins').children) {
    pin.setAttribute('aria-expanded', String(pin.dataset.reference === reference?.id));
  }
  if (!reference) return;
  byId('object-name').textContent = reference.name;
  byId('object-description').textContent = reference.description;
  byId('object-catalog').textContent = reference.source + ' · ' + reference.id;
  byId('object-position').textContent = positionText(reference.ra, reference.dec);
  byId('object-source').href = reference.url ??
    'https://simbad.cds.unistra.fr/simbad/sim-id?Ident=' + encodeURIComponent(reference.id);
}

function rememberTarget(ra, dec, label, fov = viewer.getFoV()[0]) {
  lastTarget = { ra, dec, label, fov };
  returnButton.textContent = 'Return to ' + label;
  returnButton.title = returnButton.textContent;
}

function pointAt(ra, dec, fov) {
  viewer.stopAnimation();
  viewer.gotoRaDec(ra, dec);
  if (fov !== undefined) viewer.setFoV(fov);
  updatePosition();
}

function goToReference(reference) {
  searchRevision++;
  showNavigationStatus('');
  byId('guide').open = false;
  target.value = reference.id;
  pointAt(reference.ra, reference.dec, reference.fov);
  rememberTarget(reference.ra, reference.dec, reference.id, reference.fov);
  inspect(reference);
}

function frameLayer(index) {
  return A.HiPS(location.origin + '/dr1-frame/' + index, {
    imgFormat: 'png',
    errorCallback: () => {
      if (survey.value !== 'infrared' || Number(channel.value) !== index) return;
      clearTimeout(loadDeadline);
      showNotice('Couldn’t load this wavelength. Try another wavelength or reload.');
    },
  });
}

function updateLoading() {
  clearTimeout(loadDeadline);
  if (loadedFrames.has(activeFrame) && viewer.getBaseImageLayer() === layer && layer.added) {
    showNotice('');
    return;
  }
  showNotice('Loading infrared imagery…');
  loadDeadline = setTimeout(() => showNotice('Imagery is taking longer than usual. You can try another wavelength.'), 8000);
}

function applyChannel() {
  const index = Number(channel.value);
  if (blankFrames.has(index)) {
    clearTimeout(loadDeadline);
    showNotice('SPHEREx has no image at this wavelength. Choose another wavelength to keep exploring.', true);
    return;
  }
  if (activeFrame !== index || viewer.getBaseImageLayer() !== layer) {
    const fov = viewer.getFoV()[0];
    const center = viewer.getRaDec();
    viewer.stopAnimation();
    activeFrame = index;
    layer = frameLayer(index);
    viewer.setBaseImageLayer(layer);
    pointAt(...center, fov);
  }
  updateLoading();
}

returnButton.addEventListener('click', () => {
  searchRevision++;
  showNavigationStatus('');
  pointAt(lastTarget.ra, lastTarget.dec, lastTarget.fov);
});
byId('close-inspector').addEventListener('click', () => {
  const pin = Array.from(byId('map-pins').children).find(button => button.dataset.reference === selectedReference?.id);
  inspect(null);
  (pin && !pin.hidden ? pin : returnButton).focus();
});
byId("guide").addEventListener("toggle", event => {
  if (event.target.open) inspect(null);
});

channel.addEventListener('change', applyChannel);
function opticalLayer() {
  return A.HiPS(opticalUrl, {
    imgFormat: 'jpeg',
    errorCallback: () => {
      if (survey.value === 'optical') showNotice('Couldn’t load DSS2. Try SPHEREx or reload the map.');
    },
  });
}

survey.addEventListener('change', () => {
  const infrared = survey.value === 'infrared';
  const source = byId('image-source');
  channel.hidden = !infrared;
  channel.disabled = !infrared;
  source.textContent = infrared ? 'SPHEREx DR1' : 'DSS2 · STScI/NASA, CDS';
  source.href = infrared ? 'https://doi.org/10.26131/IRSA679' : 'https://doi.org/10.26093/cds/aladin/ht9n-7r';
  clearTimeout(loadDeadline);
  showNotice('');
  if (infrared) {
    applyChannel();
    return;
  }
  const center = viewer.getRaDec();
  const fov = viewer.getFoV()[0];
  viewer.setBaseImageLayer(opticalLayer());
  pointAt(...center, fov);
});

byId('navigation').addEventListener('submit', event => {
  event.preventDefault();
  const query = target.value.trim();
  if (!viewer || !query) return;
  const revision = ++searchRevision;
  const normalized = query.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  showNavigationStatus('');
  const reference = references.find(item =>
    [item.id, item.name, item === home ? 'Horsehead' : item.id === 'M 42' ? 'Orion' : null].some(name => name?.toLowerCase().replace(/\s/g, '') === normalized));
  if (reference) {
    goToReference(reference);
    return;
  }
  try {
    const position = coordinates(query);
    if (position) {
      pointAt(...position);
      rememberTarget(...position, 'coordinates');
      inspect(null);
      return;
    }
  } catch (error) {
    showNavigationStatus(error.message);
    return;
  }
  showNavigationStatus('Finding ' + query + '…');
  viewer.gotoObject(query, {
    success: ([ra, dec]) => {
      if (revision !== searchRevision) {
        pointAt(lastTarget.ra, lastTarget.dec, lastTarget.fov);
        return;
      }
      rememberTarget(ra, dec, query);
      updatePosition();
      inspect(null);
      showNavigationStatus('');
    },
    error: () => {
      if (revision === searchRevision) showNavigationStatus('Couldn’t find that name. Try M42, M31, or sky coordinates.');
    }
  });
});

async function start() {
  try {
    const metadata = fetch('/irsa.properties').then(response => {
      if (!response.ok) throw new Error('Wavelength labels unavailable.');
      return response.text();
    }).then(parseProperties).catch(() => null);
    ({ default: A } = await import('/vendor/aladin.js'));
    await A.init;

    viewer = A.aladin(byId('sky'), {
      target: `${home.ra} ${home.dec}`, fov: home.fov, cooFrame: 'ICRS',
      showSimbadPointerControl: false, showGotoControl: false, showShareControl: false,
      showProjectionControl: false, showFullscreenControl: false, showLayersControl: false,
      showReticle: false, survey: opticalLayer(), log: false,
    });
    viewer.on('positionChanged', updatePosition);
    const openBarnard = setupBarnard(viewer, A, pointAt);
    viewer.on('wheelTriggered', event => {
      const delta = event.deltaY;
      if (!delta) return;
      const field = viewer.getFoV()[0];
      const step = Math.min(Math.abs(delta) * (event.deltaMode ? .08 : .002), .22);
      viewer.setFoV(Math.min(160, Math.max(.015, field * Math.exp(Math.sign(delta) * step))));
    });
    viewer.on('stackChanged', () => {
      if (survey.value === 'infrared' && !blankFrames.has(Number(channel.value))) updateLoading();
    });
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        const path = new URL(entry.name).pathname;
        const tile = path.match(/^\/dr1-frame\/(\d+)\/.*\.png$/);
        if (!tile || entry.responseStatus < 200 || entry.responseStatus >= 400) continue;
        loadedFrames.add(Number(tile[1]));
      }
      if (survey.value === 'infrared' && Number(channel.value) === activeFrame && loadedFrames.has(activeFrame) && !notice.hidden) updateLoading();
    }).observe({ type: 'resource', buffered: true });

    const pins = [...references, barnardMarker].map(reference => {
      const pin = document.createElement('button');
      pin.className = 'map-pin';
      pin.type = 'button';
      pin.dataset.reference = reference.id;
      pin.setAttribute('aria-controls', 'inspector');
      pin.setAttribute('aria-expanded', 'false');
      const label = document.createElement('span');
      label.textContent = reference.name;
      pin.append(label);
      pin.addEventListener('click', () => {
        searchRevision++;
        showNavigationStatus('');
        if (reference === barnardMarker) {
          inspect(null);
          openBarnard();
          return;
        }
        rememberTarget(reference.ra, reference.dec, reference === home ? 'Horsehead' : reference.id);
        inspect(selectedReference === reference ? null : reference);
      });
      byId('map-pins').append(pin);
      return { pin, reference };
    });
    function positionPins() {
      const { clientWidth, clientHeight } = byId('sky');
      for (const { pin, reference } of pins) {
        const point = viewer.world2pix(reference.ra, reference.dec);
        pin.hidden = !point || !point.every(Number.isFinite) ||
          point[0] < 0 || point[0] > clientWidth || point[1] < 0 || point[1] > clientHeight;
        if (pin.hidden) continue;
        pin.style.left = point[0] + 'px';
        pin.style.top = point[1] + 'px';
        pin.classList.toggle('label-left', point[0] > clientWidth - 170);
      }
      requestAnimationFrame(positionPins);
    }
    positionPins();
    for (const reference of references) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = reference.name;
      button.addEventListener('click', () => goToReference(reference));
      byId('references').append(button);
    }
    const barnardShortcut = byId('barnard-shortcut');
    barnardShortcut.addEventListener('click', () => {
      searchRevision++;
      inspect(null);
      openBarnard();
    });
    barnardShortcut.disabled = false;
    returnButton.disabled = false;
    byId('go').disabled = false;
    updatePosition();
    if (notice.textContent === 'Starting the sky map…') showNotice('');
    const wavelengths = await metadata;
    survey.disabled = false;
    if (!wavelengths) {
      survey.options[1].textContent = 'SPHEREx · unavailable';
      survey.options[1].disabled = true;
      return;
    }
    wavelengths.forEach((wavelength, index) => {
      channel.add(new Option(`${wavelength.toFixed(3)} µm${blankFrames.has(index) ? ' · no image' : ''}`, index));
      channel.options[index].disabled = blankFrames.has(index);
    });
    channel.value = String(activeFrame);

  } catch (error) {
    console.error(error);
    showNotice('The sky map couldn’t start. Reload the page and check that WebGL2 is enabled.');
  }
}
start();
