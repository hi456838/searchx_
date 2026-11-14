import { parseProperties, references } from './sky-data.js';
import { catalogQuery, search } from './search.js';
import { uiState } from './ui-state.js';
import { setupObservations } from './observations.js';

import { barnardMarker, setupBarnard } from './barnard-timelapse.js';

const byId = id => document.getElementById(id);
const channel = byId('channel');
const survey = byId('survey');
const opticalUrl = 'https://irsa.ipac.caltech.edu/data/hips/CDS/DSS2/color';
const notice = byId('notice');
const target = byId('target');
const returnButton = byId('home');
const exhibits = {
  'Barnard 33': {type:'DARK NEBULA', why:'The Horsehead is a cloud of dust and gas seen in silhouette against a brighter background, revealing how interstellar dust blocks visible light.', url:'https://science.nasa.gov/asset/hubble/the-horsehead-nebula/'},
  'M 42': {type:'EMISSION NEBULA', why:'The Orion Nebula is a nearby stellar nursery. Its gas and dust provide a place to study how stars form.', url:'https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-42/'},
  'M 31': {type:'SPIRAL GALAXY', why:'Andromeda is our nearest major galactic neighbour. Its relatively close view helps astronomers study the stars and history of a spiral galaxy.', url:'https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-31/'},
  'M 101': {type:'SPIRAL GALAXY', why:'We see this spiral galaxy nearly face-on, making its arms and star-forming regions easier to study across the disk.', url:'https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-101/'}
};
function syncState() { document.querySelector('main').dataset.state = uiState({searchOpen:!byId('search-popup').hidden, inspectorOpen:!byId('inspector').hidden, lessonOpen:!byId('lesson').hidden}); }
const blankFrames = new Set([50, 51]);
const home = references[0];
const loadedFrames = new Set();
let viewer, A, layer;
let selectedReference;
let activeFrame = 62;
let searchRevision = 0;
let selectObservations;
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
  const center = viewer.getRaDec();
  if (center?.every(Number.isFinite)) byId('position').textContent = positionText(...center);
}

function inspect(reference) {
  if (reference) { byId("guide").open = false; byId('lesson').hidden = true; }

  selectedReference = reference;
  byId('inspector').hidden = !reference;
  syncState();
  for (const pin of byId('map-pins').children) {
    pin.setAttribute('aria-expanded', String(pin.dataset.reference === reference?.id));
  }
  if (!reference) return;
  byId('object-fields').closest('details').open = false;
  byId('copy-status').textContent = '';
  const exhibit = exhibits[reference.id] ?? {
    type: reference.category ?? 'SKY OBJECT',
    why: reference.description,
    url: 'https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/',
  };
  byId('object-type').textContent = exhibit.type;
  byId('object-id').textContent = reference.id + '  ·  ' + reference.source;
  byId('object-why').textContent = exhibit.why;
  byId('object-learn').href = exhibit.url;
  byId('object-name').textContent = reference.name;
  byId('object-description').textContent = reference.description;
  byId('object-catalog').textContent = reference.source + ' · ' + reference.id;
  byId('object-position').textContent = positionText(reference.ra, reference.dec);
  byId('object-source').href = reference.url ??
    'https://simbad.cds.unistra.fr/simbad/sim-id?Ident=' + encodeURIComponent(reference.id);
}

function rememberTarget(ra, dec, label, fov = viewer.getFoV()[0]) {
  lastTarget = { ra, dec, label, fov };
  returnButton.title = 'Recenter on ' + label + ' at the saved zoom';
  returnButton.setAttribute('aria-label', returnButton.title);
}

function pointAt(ra, dec, fov) {
  // Any newer map navigation supersedes a pending name-resolution request.
  searchRevision++;
  viewer.stopAnimation();
  viewer.gotoRaDec(ra, dec);
  if (fov !== undefined) viewer.setFoV(fov);
  byId('position').textContent = positionText(ra, dec);
  requestAnimationFrame(updatePosition);
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
  target.focus({preventScroll:true}); dismiss();
});
byId("guide").addEventListener("toggle", event => {
  if (event.target.open) inspect(null);
});

// Move only from the explicit handle so text, links and map gestures remain usable.
for (const panel of document.querySelectorAll('.inspector')) {
  const handle = panel.querySelector('.drag-handle');
  let drag;
  function place(x, y) {
    const rect = panel.getBoundingClientRect();
    const maxX = Math.max(0, document.documentElement.clientWidth - rect.width);
    const maxY = Math.max(0, document.documentElement.clientHeight - rect.height);
    panel.style.left = Math.round(Math.max(0, Math.min(x, maxX))) + 'px';
    panel.style.top = Math.round(Math.max(0, Math.min(y, maxY))) + 'px';
    panel.style.right = 'auto'; panel.style.bottom = 'auto';
    panel.dataset.moved = 'true';
    panel.querySelector('.reset-panel').hidden = false;
  }
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const rect = panel.getBoundingClientRect();
    drag = { pointer: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top };
    handle.setPointerCapture(event.pointerId);
    handle.classList.add('dragging');
    event.preventDefault();
  });
  handle.addEventListener('pointermove', event => {
    if (drag?.pointer === event.pointerId) place(event.clientX - drag.x, event.clientY - drag.y);
  });
  function stop(event) {
    if (drag?.pointer !== event.pointerId) return;
    drag = undefined; handle.classList.remove('dragging');
  }
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
  handle.addEventListener('lostpointercapture', stop);
  const reset = panel.querySelector('.reset-panel');
  function resetPosition() { panel.style.removeProperty('left'); panel.style.removeProperty('top'); panel.style.removeProperty('right'); panel.style.removeProperty('bottom'); delete panel.dataset.moved; reset.hidden = true; }
  reset.addEventListener('click', resetPosition);
  handle.addEventListener('keydown', event => {
    const directions = { ArrowLeft: [-1,0], ArrowRight: [1,0], ArrowUp: [0,-1], ArrowDown: [0,1] };
    if (event.key === 'Home') { event.preventDefault(); resetPosition(); return; }
    if (!directions[event.key]) return;
    event.preventDefault();
    const rect = panel.getBoundingClientRect(); const step = event.shiftKey ? 50 : 10;
    const [dx,dy] = directions[event.key]; place(rect.left + dx * step, rect.top + dy * step);
  });
  function keepVisible() {
    if (panel.hidden || !panel.dataset.moved) return;
    const rect = panel.getBoundingClientRect(); place(rect.left, rect.top);
  }
  window.addEventListener('resize', keepVisible);
  new ResizeObserver(keepVisible).observe(panel);
}

function opticalLayer() {
  return A.HiPS(opticalUrl, {imgFormat:'jpeg', errorCallback:()=>{
    if (survey.value === 'optical') showNotice('Couldn’t load DSS2. Try SPHEREx or reload the map.');
  }});
}
survey.addEventListener('change', () => {
  if (!viewer) return;
  const infrared = survey.value === 'infrared';
  const source = byId('image-source');
  channel.hidden = !infrared; channel.disabled = !infrared;
  source.textContent = infrared ? 'SPHEREx DR1' : 'DSS2 · STScI/NASA, CDS';
  source.href = infrared ? 'https://doi.org/10.26131/IRSA679' : 'https://doi.org/10.26093/cds/aladin/ht9n-7r';
  clearTimeout(loadDeadline); showNotice('');
  if (infrared) { applyChannel(); return; }
  const center = viewer.getRaDec(), fov = viewer.getFoV()[0];
  viewer.setBaseImageLayer(opticalLayer()); pointAt(...center, fov);
});
channel.addEventListener('change', applyChannel);
byId('copy-position').addEventListener('click', async () => {
  const status=byId('copy-status');
  try { await navigator.clipboard.writeText(`${selectedReference.ra}, ${selectedReference.dec}`); status.textContent=' Copied.'; }
  catch { status.textContent=' Copy unavailable; select the coordinates above.'; }
});
byId('sky').addEventListener('pointerdown', () => { ++searchRevision; showNavigationStatus(''); });
byId('sky').addEventListener('wheel', () => { ++searchRevision; showNavigationStatus(''); }, { passive: true });

const popup = byId('search-popup');
const list = byId('suggestions');
let matches = [], active = -1;
function dismiss() { popup.hidden = true; target.setAttribute('aria-expanded','false'); target.removeAttribute('aria-activedescendant'); active = -1; syncState(); }
function render() {
  const result = search(target.value); matches = result.results.slice(0, 6); active = -1;
  const query = target.value.trim();
  if (query && !result.error && !result.ambiguous && !matches.some(entry => entry.type === 'coordinates')) {
    matches.push({ type: 'catalog', name: 'Find “' + query + '” in the sky catalog',
      description: 'Search CDS Sesame by object name or catalog ID', category: 'Catalog', query: catalogQuery(query) });
  }
  byId('clear-search').hidden = !target.value;
  byId('suggestion-heading').textContent = target.value ? (result.ambiguous ? 'CHOOSE WHAT YOU MEAN' : 'SEARCH RESULTS') : 'EXPLORE THE UNIVERSE';
  list.replaceChildren();
  matches.forEach((entry,i)=>{
    const option=document.createElement('div'); option.id='suggestion-'+i; option.role='option'; option.setAttribute('aria-selected','false'); option.className='suggestion';
    const icon=document.createElement('span'); icon.className='result-icon'; icon.textContent=entry.type==='lesson'?'✦':entry.type==='coordinates'?'⌖':'◌'; icon.setAttribute('aria-hidden','true');
    const text=document.createElement('span'); const title=document.createElement('strong'); title.textContent=entry.name; const detail=document.createElement('small'); detail.textContent=entry.description; text.append(title,detail);
    const category=document.createElement('span'); category.className='result-category'; category.textContent=entry.category;
    option.append(icon,text,category); option.addEventListener('pointerdown',e=>e.preventDefault()); option.addEventListener('click',()=>choose(entry)); list.append(option);
  });
  byId('search-hint').textContent=result.error || (!matches.length ? 'No local match. Press Enter or the search button to try the astronomical name resolver.' : target.value ? `${matches.length} ${matches.length === 1 ? 'result' : 'results'} · ↑ ↓ to explore · Enter to select` : 'Choose a destination, ask a question, or enter RA, Dec');
  popup.hidden=false; target.setAttribute('aria-expanded','true'); target.removeAttribute('aria-activedescendant'); syncState();
}
function setActive(index) { active=(index+matches.length)%matches.length; [...list.children].forEach((el,i)=>el.setAttribute('aria-selected',String(i===active))); target.setAttribute('aria-activedescendant','suggestion-'+active); list.children[active]?.scrollIntoView({block:'nearest'}); }
function choose(entry) {
  if (entry.type === 'catalog') { resolveExternal(entry.query); return; }
  const refresh = !byId('observation-panel').hidden;
  if (refresh) selectObservations.close();
  if (!byId('barnard-panel').hidden) byId('barnard-close').click();
  ++searchRevision; dismiss(); showNavigationStatus(''); target.value=entry.name; byId('clear-search').hidden=false;
  if(entry.type==='lesson') { inspect(null); byId('guide').open=false; byId('lesson-name').textContent=entry.name; byId('lesson-body').textContent=entry.body; byId('lesson-source').href=entry.url; byId('lesson').hidden=false; syncState(); return; }
  byId('lesson').hidden=true; syncState();
  if(!viewer) {showNavigationStatus('The sky map is still starting. Select this result again when it is ready.');return;}
  if(entry.type==='object') {
    goToReference(entry);
    target.value=entry.name;
    if (refresh) { inspect(null); void selectObservations(entry.ra, entry.dec); }
    return;
  }
  pointAt(...entry.position); rememberTarget(...entry.position,'coordinates'); inspect(null);
  if (refresh) void selectObservations(...entry.position);
}
function resolveExternal(query) {
  if(!viewer || !A) {showNavigationStatus('The sky map is still starting. Try again shortly.');return;}
  const revision=++searchRevision; showNavigationStatus('Searching the Sesame astronomical name resolver…'); dismiss();
  const timeout=setTimeout(()=>{if(revision===searchRevision){++searchRevision;showNavigationStatus('The name resolver did not respond. Try again or enter coordinates.');}},10000);
  A.Sesame.resolveAstronomicalName(query, ({ra,dec})=>{
    clearTimeout(timeout); if(revision!==searchRevision)return;
    if(!Number.isFinite(ra)||!Number.isFinite(dec)||ra<0||ra>=360||Math.abs(dec)>90){showNavigationStatus('The resolver returned an invalid position.');return;}
    const refresh = !byId('observation-panel').hidden;
    if (!byId('barnard-panel').hidden) byId('barnard-close').click();
    pointAt(ra,dec); rememberTarget(ra,dec,query); inspect(null); byId('lesson').hidden=true; syncState(); showNavigationStatus('Position resolved by CDS Sesame.');
    if (refresh) void selectObservations(ra, dec);
  },()=>{clearTimeout(timeout);if(revision===searchRevision)showNavigationStatus('No object found. Try a catalog ID, a different spelling, or RA and Dec.');});
}
target.addEventListener('focus',render);
target.addEventListener('click',()=>{if(popup.hidden)render();});
target.addEventListener('input',()=>{++searchRevision;showNavigationStatus('');render();});
target.addEventListener('keydown',event=>{
  if(event.key==='Escape' && !popup.hidden){event.stopPropagation();dismiss();return;}
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();if(popup.hidden)render();if(matches.length)setActive(active < 0 ? (event.key==='ArrowDown' ? 0 : matches.length-1) : active+(event.key==='ArrowDown'?1:-1));}
});
byId('navigation').addEventListener('submit',event=>{
  event.preventDefault(); const query=target.value.trim(); if(!query){render();return;}
  const result=search(query); if(result.error){showNavigationStatus(result.error);render();return;}
  if(active>=0 && !popup.hidden){choose(matches[active]);return;}
  if(result.exact){choose(result.exact);return;}
  if(result.ambiguous){render();showNavigationStatus('Choose a result from the suggestions.');return;}
  if(result.results[0]?.type === 'coordinates'){choose(result.results[0]);return;}
  if (result.results.length) {
    render();
    showNavigationStatus('Choose a suggestion or search the full sky catalog.');
    return;
  }
  resolveExternal(catalogQuery(query));
});
byId('clear-search').addEventListener('click',()=>{++searchRevision;target.value='';showNavigationStatus('');target.focus();render();});
document.addEventListener('pointerdown',event=>{if(!byId('navigation').contains(event.target))dismiss();});
document.addEventListener('keydown',event=>{if(event.key!=='Escape'||!popup.hidden)return; if(!byId('inspector').hidden){byId('close-inspector').click();} else if(!byId('lesson').hidden){byId('close-lesson').click();} else if(byId('guide').open){byId('guide').open=false;byId('guide').querySelector('summary').focus();}});
target.addEventListener('blur',()=>setTimeout(()=>{if(!byId('navigation').contains(document.activeElement))dismiss();},0));
byId('close-lesson').addEventListener('click',()=>{byId('lesson').hidden=true;target.focus({preventScroll:true});dismiss();});

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
    selectObservations = setupObservations(viewer, A, () => inspect(null));
    byId('object-observations').addEventListener('click', () => {
      if (!selectedReference) return;
      const { ra, dec } = selectedReference;
      inspect(null);
      void selectObservations(ra, dec);
    });
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
          if (!byId('observation-panel').hidden) byId('observation-close').click();
          inspect(null);
          selectObservations.close();
          openBarnard();
          return;
        }
        rememberTarget(reference.ra, reference.dec, reference === home ? 'Horsehead' : reference.id);
        dismiss(); inspect(selectedReference?.id === reference.id ? null : reference);
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
      if (!byId('observation-panel').hidden) byId('observation-close').click();
      searchRevision++;
      inspect(null);
      selectObservations.close();
      openBarnard();
    });
    barnardShortcut.disabled = false;
    returnButton.disabled = false;

    updatePosition();
    if (notice.textContent === 'Starting the sky map…') showNotice('');
    const wavelengths = await metadata;
    survey.disabled = false;
    if (!wavelengths) { survey.options[1].textContent = 'SPHEREx · unavailable'; survey.options[1].disabled = true; return; }
    wavelengths.forEach((wavelength, index) => {
      channel.add(new Option(`${wavelength.toFixed(3)} µm${blankFrames.has(index) ? ' · no image' : ''}`, index));
      channel.options[index].disabled = blankFrames.has(index);
    });
    channel.value = String(activeFrame);
    channel.disabled = true;
  } catch (error) {
    console.error(error);
    showNotice('The sky map couldn’t start. Reload the page and check that WebGL2 is enabled.');
  }
}
syncState();
start();
