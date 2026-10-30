// ============================================================================
// Central Ganadera — REMIX Validación · Interfaz
// ============================================================================
import * as E from './engine.js';
import * as D from './data.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const state = {
  user: null,
  meta: null,
  index: null,
  eqDocs: [],
  eq: E.buildEquivalences([]),
  results: [],          // [{ id, source, sourceRow, input, result }]
  filter: 'todos',
  extraHeaders: [],     // columnas adicionales del último informe (solo se muestran y exportan)
  open: new Set(),
  pendingFile: null,    // { rows, fileName, sheet, headerRow }
  lastFileName: null,
  localPending: new Set(),
  remixDraft: null,
  confs: new Map(),     // confirmaciones manuales activas: clave del registro → documento
  saving: new Set(),    // ids de filas con una confirmación en curso
};
let seq = 0;

// ---------------------------------------------------------------------------
// Utilidades de interfaz
// ---------------------------------------------------------------------------
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 6000 : 3200);
}

function friendlyError(err) {
  const code = err?.code || '';
  if (code.includes('permission-denied')) return 'No tiene permiso para esta acción.';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'Correo o contraseña incorrectos.';
  if (code.includes('too-many-requests')) return 'Demasiados intentos. Espere unos minutos.';
  if (code.includes('unavailable') || code.includes('network')) return 'Sin conexión con el servidor. Revise internet.';
  return err?.message || 'Ocurrió un error inesperado.';
}

function show(view) {
  for (const v of ['loading', 'setup', 'login', 'app']) $(`#view-${v}`).hidden = v !== view;
}

const fmtDate = (ts) => {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
  return d ? d.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
};
const fieldLabel = (key) => E.FIELDS.find((f) => f.key === key)?.label ?? key;

// ---------------------------------------------------------------------------
// Arranque y sesión
// ---------------------------------------------------------------------------
for (const img of $$('.logo')) {
  const fallback = () => img.closest('.logo-wrap').classList.add('no-logo');
  img.addEventListener('error', fallback);
  if (img.complete && img.naturalWidth === 0) fallback();
}

if (!D.isConfigured) {
  show('setup');
} else {
  D.onAuth(async (user) => {
    state.user = user;
    if (!user) { show('login'); return; }
    show('loading');
    try {
      await loadData();
      $('#user-label').textContent = user.email;
      show('app');
    } catch (err) {
      console.error(err);
      show('login');
      showLoginError(friendlyError(err));
    }
  });
}

function showLoginError(msg) {
  const el = $('#login-error');
  el.textContent = msg;
  el.hidden = !msg;
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showLoginError('');
  const btn = $('#login-submit');
  btn.disabled = true;
  try {
    await D.login($('#login-email').value, $('#login-password').value);
  } catch (err) {
    showLoginError(friendlyError(err));
  } finally {
    btn.disabled = false;
  }
});

$('#login-reset').addEventListener('click', async () => {
  const email = $('#login-email').value.trim();
  if (!email) { showLoginError('Escriba su correo y vuelva a pulsar «Olvidé mi contraseña».'); return; }
  try {
    await D.resetPassword(email);
    showLoginError('');
    toast('Si el correo existe, recibirá un enlace para restablecer la contraseña.');
  } catch (err) { showLoginError(friendlyError(err)); }
});

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="logout"]')) {
    state.results = [];
    state.open.clear();
    state.confs.clear();
    D.logout();
  }
});

// ---------------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------------
async function loadData() {
  state.meta = await D.getRemixMeta();
  state.index = null;
  if (state.meta?.activeVersion) {
    const rows = await D.loadRemixVersion(state.meta.activeVersion);
    state.index = E.buildIndex(rows);
  }
  await loadEquivalences();
  await loadConfirmations();
  renderRemixStatus();
  fillDatalists();
  restoreSession();
}

async function loadConfirmations() {
  try {
    const docs = await D.loadConfirmations();
    state.confs = new Map(docs.map((d) => [d.key, d]));
  } catch (err) {
    console.warn('No se cargaron las confirmaciones', err);
    state.confs = new Map();
  }
}

async function loadEquivalences() {
  state.eqDocs = await D.loadEquivalences();
  state.eq = E.buildEquivalences(state.eqDocs);
}

function renderRemixStatus() {
  const chip = $('#remix-chip');
  const banner = $('#no-remix');
  chip.classList.toggle('on', !!state.index);
  $('#footer-remix').textContent = state.index
    ? `REMIX activo: ${state.meta.fileName || state.meta.activeVersion} · actualizado ${fmtDate(state.meta.updatedAt)}${state.meta.updatedByEmail ? ` por ${state.meta.updatedByEmail}` : ''}`
    : '';
  if (state.index) {
    chip.textContent = `REMIX · ${state.index.rowCount.toLocaleString('es-CO')} relaciones`;
    chip.title = `Versión ${state.meta.activeVersion} · ${state.meta.fileName || ''} · ${fmtDate(state.meta.updatedAt)}`;
    banner.hidden = true;
  } else {
    chip.textContent = 'REMIX sin cargar';
    banner.hidden = false;
    banner.textContent = 'Todavía no hay una base REMIX cargada. Cárguela desde Configuración (⚙) → REMIX para empezar a validar.';
  }
}

function fillDatalists() {
  for (const { key } of E.FIELDS) {
    const dl = $(`#dl-${key}`);
    dl.replaceChildren();
    if (!state.index) continue;
    const names = state.index.fields[key].entries.map((e) => e.display).sort((a, b) => a.localeCompare(b, 'es'));
    const frag = document.createDocumentFragment();
    for (const n of names) frag.append(h('option', { value: n }));
    dl.append(frag);
  }
}

function requireRemix() {
  if (state.index) return true;
  toast('No hay una base REMIX cargada.', true);
  return false;
}

// ---------------------------------------------------------------------------
// A. Validación manual
// ---------------------------------------------------------------------------
$('#manual-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!requireRemix()) return;
  const input = {
    cliente: $('#in-cliente').value.trim(),
    facturador: $('#in-facturador').value.trim(),
    proveedor: $('#in-proveedor').value.trim(),
  };
  if (!input.cliente && !input.facturador && !input.proveedor) {
    toast('Escriba al menos un nombre.', true);
    return;
  }
  const result = E.validateRecord(state.index, state.eq, input);
  const item = { id: ++seq, source: 'manual', input, result, extra: [] };
  state.results.unshift(item);
  if (E.isWarning(result)) state.open.add(item.id);
  state.filter = 'todos';
  applyConfirmations([item]);
  renderResults();
  saveSession();
  logHistory('manual', null, [result]);
  $('#results-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ---------------------------------------------------------------------------
// B. Carga de Excel
// ---------------------------------------------------------------------------
async function readSheetFile(file, kind = 'informe') {
  if (!window.XLSX) throw new Error('No se pudo cargar el lector de Excel. Revise la conexión y recargue la página.');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  let lastError = 'El archivo no tiene hojas.';
  for (const sheet of wb.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: false, defval: '' });
    const parsed = E.rowsFromMatrix(matrix, kind);
    if (!parsed.errors.length) return { ...parsed, sheet };
    lastError = parsed.errors[0];
  }
  throw new Error(lastError);
}

const dz = $('#dropzone');
dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
dz.addEventListener('drop', (e) => {
  e.preventDefault();
  dz.classList.remove('drag');
  if (e.dataTransfer.files[0]) handleReportFile(e.dataTransfer.files[0]);
});
$('#file-input').addEventListener('change', (e) => {
  if (e.target.files[0]) handleReportFile(e.target.files[0]);
  e.target.value = '';
});

async function handleReportFile(file) {
  try {
    const parsed = await readSheetFile(file);
    if (!parsed.rows.length) throw new Error('El archivo tiene encabezados pero ningún registro.');
    state.pendingFile = { ...parsed, fileName: file.name };
    renderPreview();
  } catch (err) {
    toast(friendlyError(err), true);
  }
}

function renderPreview() {
  const p = state.pendingFile;
  $('#file-preview').hidden = !p;
  dz.hidden = !!p;
  if (!p) return;
  $('#file-name').textContent = p.fileName;
  const extras = p.extraHeaders || [];
  $('#file-meta').textContent = `${p.rows.length} registros · hoja «${p.sheet}» · encabezados en la fila ${p.headerRow + 1}`
    + (extras.length ? ` · ${extras.length} columnas adicionales (se muestran, no se validan)` : '')
    + (p.skipped ? ` · ${p.skipped} filas vacías omitidas` : '');
  const table = $('#preview-table');
  table.replaceChildren(
    h('thead', {}, h('tr', {}, h('th', { class: 'num', text: 'Fila' }),
      ...E.FIELDS.map((f) => h('th', { class: 'key-col', text: f.label })),
      ...extras.map((x) => h('th', { class: 'extra-col', text: x })))),
    h('tbody', {}, ...p.rows.slice(0, 200).map((r) => h('tr', {},
      h('td', { class: 'num', text: r.sourceRow }),
      h('td', { text: r.cliente || '—' }), h('td', { text: r.facturador || '—' }), h('td', { text: r.proveedor || '—' }),
      ...r.extra.map((v) => h('td', { class: 'extra-col', text: v }))))),
  );
}

$('#btn-file-clear').addEventListener('click', () => { state.pendingFile = null; renderPreview(); });

$('#btn-file-validate').addEventListener('click', () => {
  if (!requireRemix() || !state.pendingFile) return;
  const p = state.pendingFile;
  state.extraHeaders = p.extraHeaders || [];
  state.results = p.rows.map((r) => ({
    id: ++seq, source: 'excel', sourceRow: r.sourceRow, extra: r.extra || [],
    input: { cliente: r.cliente, facturador: r.facturador, proveedor: r.proveedor },
    result: E.validateRecord(state.index, state.eq, r),
  }));
  state.lastFileName = p.fileName;
  state.open.clear();
  state.filter = 'todos';
  state.pendingFile = null;
  const reapplied = applyConfirmations(state.results);
  renderPreview();
  renderResults();
  saveSession();
  logHistory('excel', p.fileName, state.results.map((x) => x.result));
  const ok = state.results.filter((x) => effStatus(x) === E.STATUS.CORRECTO).length;
  toast(`${state.results.length} registros validados · ${ok} correctos`
    + (reapplied.applied ? ` · ${reapplied.applied} confirmados antes` : '')
    + (reapplied.stale ? ` · ${reapplied.stale} confirmaciones ya no aplican` : '') + '.');
  $('#results-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

function logHistory(source, fileName, results) {
  D.saveHistory({ source, fileName, remixVersion: state.meta?.activeVersion || null, results })
    .catch((err) => console.warn('No se guardó el historial', err));
}

// ---------------------------------------------------------------------------
// C. Resultados
// ---------------------------------------------------------------------------
// Categorías de resultado = filtros. El orden es el de la franja de resumen.
const CATS = [
  { key: 'todos', label: 'Todos', cls: 'all', match: () => true },
  { key: 'correcto', label: 'Correctos', cls: 'ok', status: E.STATUS.CORRECTO },
  { key: 'nuevo', label: 'Nuevo proveedor', cls: 'np', status: E.STATUS.NUEVO_PROVEEDOR },
  { key: 'cliente', label: 'Validar cliente', cls: 'vc', status: E.STATUS.VALIDAR_CLIENTE },
  { key: 'revisar', label: 'Revisar', cls: 'rev', status: E.STATUS.REVISAR },
  { key: 'noenc', label: 'No encontrados', cls: 'no', status: E.STATUS.NO_ENCONTRADO },
  { key: 'relacion', label: 'Relación no registrada', cls: 'rel', status: E.STATUS.RELACION },
  { key: 'central', label: 'Central Ganadera', cls: 'cg', status: E.STATUS.CENTRAL },
];
for (const c of CATS) if (!c.match) c.match = (item) => effStatus(item) === c.status;
const BADGE = Object.fromEntries(CATS.filter((c) => c.status).map((c) => [c.status, c.cls]));
const DOT = { exacto: 'ok', equivalencia: 'ok', revisar: 'rev', no_encontrado: 'no', vacio: 'no' };
const currentCat = () => CATS.find((c) => c.key === state.filter) || CATS[0];

function dotClass(r, key) {
  if (r.status === E.STATUS.CENTRAL && key === 'proveedor') return 'cg';
  if (r.status === E.STATUS.NUEVO_PROVEEDOR && key === 'proveedor') return 'np';
  if (r.status === E.STATUS.VALIDAR_CLIENTE && key === 'cliente') return 'vc';
  return DOT[r.fields[key].status];
}

$('#summary').addEventListener('click', (e) => {
  const b = e.target.closest('[data-filter]');
  if (!b) return;
  state.filter = b.dataset.filter;
  renderResults();
});

$('#btn-clear-results').addEventListener('click', () => {
  state.results = [];
  state.open.clear();
  renderResults();
  saveSession();
});

function visibleResults() {
  const cat = currentCat();
  return state.results.filter((x) => cat.match(x));
}

const cleanMsg = (m) => String(m || '')
  .replace(/^ADVERTENCIA: RELACIÓN NO REGISTRADA EN REMIX\.\s*/, '')
  .replace(/^(NUEVO PROVEEDOR|VALIDAR CLIENTE|NO ENCONTRADO):\s*/, '');

/** Texto de la columna Advertencia: solo el mensaje. */
function shortWarning(r) {
  if (r.status === E.STATUS.CENTRAL) return `Proveedor Central Ganadera · validación REMIX: ${r.baseStatus}`;
  if (r.status === E.STATUS.CORRECTO) return r.viaEquivalence ? 'Correcto por equivalencia aprobada.' : '—';
  const rel = r.warnings.find((x) => x.field === 'relacion');
  if (rel) return cleanMsg(rel.mensaje);
  const msgs = r.warnings.map((w) => cleanMsg(w.mensaje));
  return msgs.length ? [...new Set(msgs)].join('\n') : '—';
}

// Nombres visibles en la tabla de resultados (los internos y los del Excel no cambian).
const VIEW_LABEL = { cliente: 'Cliente de planta', facturador: 'Facturar a nombre de', proveedor: 'Proveedor' };

function suggestions(r) {
  const out = [];
  if (r.status === E.STATUS.NUEVO_PROVEEDOR) {
    if (r.newProviderKnown?.length) out.push(`Registrados: ${r.newProviderKnown.slice(0, 3).join(', ')}${r.newProviderKnown.length > 3 ? '…' : ''}`);
    return out;
  }
  for (const { key } of E.FIELDS) {
    const f = r.fields[key];
    const label = VIEW_LABEL[key];
    if (f.status === 'revisar') out.push(`${label}: ${f.candidates[0].display}`);
    else if (f.status === 'no_encontrado' && f.closest) out.push(`${label}: ${f.closest.display}?`);
  }
  return out;
}

function renderResults() {
  const total = state.results.length;
  const ok = state.results.filter((x) => effStatus(x) === E.STATUS.CORRECTO).length;
  $('#results-chip').textContent = total ? `${total} validados · ${ok} correctos` : 'Sin validar';
  $('#results-toolbar').hidden = !total;
  renderSummary();
  $('#results-empty').hidden = !!total;
  $('#results-wrap').hidden = !total;

  const list = visibleResults();
  const cat = currentCat();
  $('#filter-label').textContent = cat.key === 'todos' ? `Mostrando todos (${list.length})` : `Filtro: ${cat.label} (${list.length})`;
  $('#btn-export').lastChild.textContent = cat.key === 'todos' ? 'EXPORTAR TODO A EXCEL' : `EXPORTAR «${cat.label.toUpperCase()}» A EXCEL`;
  $('#btn-export').disabled = !list.length;
  $('#btn-show-all').hidden = cat.key === 'todos';
  $('#btn-reset-cols').hidden = !hasCustomOrder();
  const noFact = $('#no-fact-remix');
  noFact.hidden = !total || !state.index || state.index.hasFacturadorRemix;

  const cols = columnOrder().map((id) => COLUMN_DEFS(id)).filter(Boolean);
  const span = cols.length + 1;
  $('#results-head').replaceChildren(h('tr', {},
    ...cols.map((c) => headerCell(c)),
    h('th', { class: 'col-action', text: 'Gestión', title: 'Marque el chulito cuando haya gestionado la novedad' })));

  const body = $('#results-body');
  body.replaceChildren();
  list.forEach((item) => {
    const expandable = hasDetail(item);
    const isOpen = expandable && state.open.has(item.id);
    const row = h('tr', {
      class: `main-row${isOpen ? ' open' : ''}${item.manual ? ' is-manual' : ''}${expandable ? '' : ' no-detail'}`,
      tabindex: expandable ? '0' : undefined, 'aria-expanded': expandable ? String(isOpen) : undefined,
      title: expandable ? 'Clic para ver las sugerencias de nombre' : undefined,
    },
      ...cols.map((c) => c.cell(item)),
      actionCell(item, isOpen));
    const toggle = () => {
      if (state.open.has(item.id)) state.open.delete(item.id); else state.open.add(item.id);
      renderResults();
    };
    if (expandable) {
      row.addEventListener('click', toggle);
      row.addEventListener('keydown', (e) => { if (e.target === row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(); } });
    }
    body.append(row);
    if (isOpen) body.append(h('tr', { class: 'detail' }, h('td', { colspan: String(span) }, renderDetail(item))));
  });
  if (!list.length && total) {
    body.append(h('tr', {}, h('td', { colspan: String(span), class: 'muted', text: 'No hay registros en esta categoría.' })));
  }
}

// ---------------------------------------------------------------------------
// Columnas: LOTE fija al inicio; las demás (incluida NIT) se reordenan arrastrando el encabezado.
// ---------------------------------------------------------------------------
const COL_STORE = 'cg-remix-col-order-v1';
const hn = (name) => E.normalizeHeader(name);
const extraIndex = (norm) => state.extraHeaders.findIndex((x) => hn(x) === norm);
const PINNED_EXTRAS = ['LOTE'];
// Nombre visible de algunas columnas del informe (el Excel no cambia).
const EXTRA_LABEL = { NIT: 'NIT Facturar a nombre de' };
const PREFERRED_EXTRAS = ['CANTIDAD', 'FECHABENEFICIO', 'DIADEBENEFICIO'];

function nameCell(item, key) {
  const r = item.result;
  return h('td', {}, h('div', { class: 'cell-name' }, h('span', { class: `dot ${dotClass(r, key)}` }), h('span', { text: item.input[key] || '—' })));
}

const BASE_COLS = {
  fila: { label: '#', cls: 'num', cell: (item) => h('td', { class: 'num', text: item.sourceRow ?? '·', title: item.sourceRow ? `Fila ${item.sourceRow} del archivo` : 'Validación manual' }) },
  cliente: { label: VIEW_LABEL.cliente, cell: (item) => nameCell(item, 'cliente') },
  facturadorRemix: {
    label: 'Facturador (REMIX)',
    title: 'Dato de la columna «Facturador» del REMIX original. Solo informativo: no se usa para validar.',
    cell: (item) => {
      const r = item.result;
      if (!r.facturadorRemix) return h('td', { class: 'fact-remix muted-cell', text: '—', title: state.index?.hasFacturadorRemix ? 'Sin fila REMIX para este cliente y facturador' : 'El REMIX activo no trae la columna «Facturador». Vuelva a cargarlo desde ⚙.' });
      const basis = { relacion: 'De la fila REMIX de esta relación', sugerida: 'De la fila REMIX que existiría si se aceptan los nombres sugeridos', cliente: 'De las filas REMIX con este Cliente + Facturar a nombre de (la relación completa no existe)' }[r.facturadorRemixBasis];
      return h('td', { class: `fact-remix${r.facturadorRemixBasis === 'relacion' ? '' : ' approx'}`, title: basis }, r.facturadorRemix);
    },
  },
  facturador: { label: VIEW_LABEL.facturador, cell: (item) => nameCell(item, 'facturador') },
  proveedor: { label: VIEW_LABEL.proveedor, cell: (item) => nameCell(item, 'proveedor') },
  resultado: {
    label: 'Resultado',
    cell: (item) => {
      const st = effStatus(item);
      return h('td', {}, h('span', { class: `badge ${BADGE[st]}`, text: st }),
        item.manual ? h('span', { class: 'badge-manual', title: `Novedad original: ${item.manual.originalStatus}` }, '✓ Manual') : null);
    },
  },
  advertencia: {
    label: 'Advertencia',
    cell: (item) => h('td', { class: 'warn-text', text: item.manual
      ? `Gestionado por ${item.manual.byEmail || '—'} · ${fmtDate(item.manual.at)} · novedad original: ${item.manual.originalStatus}`
      : (item.staleConf ? 'Confirmación anterior ya no aplica: la novedad cambió.\n' : '') + shortWarning(item.result) }),
  },
  sugerido: {
    label: 'Nombre sugerido en REMIX',
    cell: (item) => { const sg = suggestions(item.result); return h('td', { class: 'suggest' }, ...sg.map((x) => h('div', { text: x })), sg.length ? null : '—'); },
  },
};

function COLUMN_DEFS(id) {
  if (BASE_COLS[id]) return { id, ...BASE_COLS[id] };
  if (id.startsWith('x:')) {
    const i = extraIndex(id.slice(2));
    if (i < 0) return null;
    return { id, label: EXTRA_LABEL[id.slice(2)] || state.extraHeaders[i], extra: true, title: `Columna «${state.extraHeaders[i]}» del informe (no se valida)`,
      cell: (item) => h('td', { class: 'extra-col', text: item.extra?.[i] ?? '' }) };
  }
  return null;
}

function defaultOrder() {
  const extras = state.extraHeaders.map((x) => `x:${hn(x)}`);
  const pinned = PINNED_EXTRAS.map((n) => `x:${n}`).filter((id) => extras.includes(id));
  const preferred = PREFERRED_EXTRAS.map((n) => `x:${n}`).filter((id) => extras.includes(id));
  const nit = extras.includes('x:NIT') ? ['x:NIT'] : [];
  const rest = extras.filter((id) => !pinned.includes(id) && !preferred.includes(id) && !nit.includes(id));
  const facturadorRemix = ['facturadorRemix'];
  return {
    pinned,
    movable: [...nit, 'cliente', ...facturadorRemix, 'facturador', 'proveedor', ...preferred, ...rest, 'resultado', 'advertencia', 'sugerido'],
  };
}

function readSavedOrder() {
  try { return JSON.parse(localStorage.getItem(COL_STORE) || 'null'); } catch { return null; }
}
function writeSavedOrder(order) {
  try { if (order) localStorage.setItem(COL_STORE, JSON.stringify(order)); else localStorage.removeItem(COL_STORE); } catch { /* sin almacenamiento */ }
}
const hasCustomOrder = () => !!readSavedOrder();

/** Orden guardado por el usuario aplicado a las columnas disponibles; las nuevas entran en su lugar por defecto. */
function columnOrder() {
  const { pinned, movable } = defaultOrder();
  const saved = readSavedOrder();
  if (!saved) return [...pinned, ...movable];
  const out = saved.filter((id) => movable.includes(id));
  movable.forEach((id, i) => {
    if (out.includes(id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) { const k = out.indexOf(movable[j]); if (k >= 0) { at = k + 1; break; } }
    out.splice(at, 0, id);
  });
  return [...pinned, ...out];
}

function moveColumn(dragId, targetId, after) {
  const { pinned } = defaultOrder();
  const order = columnOrder().filter((id) => !pinned.includes(id));
  const from = order.indexOf(dragId);
  if (from < 0 || dragId === targetId) return;
  order.splice(from, 1);
  let to = order.indexOf(targetId);
  if (to < 0) return;
  if (after) to += 1;
  order.splice(to, 0, dragId);
  // Se guarda la preferencia completa (incluye columnas de informes anteriores para conservar su lugar).
  const prev = readSavedOrder() || [];
  writeSavedOrder([...order, ...prev.filter((id) => !order.includes(id) && !pinned.includes(id))]);
  renderResults();
}

let dragCol = null;
function headerCell(c) {
  const pinned = PINNED_EXTRAS.some((n) => c.id === `x:${n}`);
  const th = h('th', {
    class: [c.cls, c.extra ? 'extra-col' : '', pinned ? 'col-pinned' : 'col-drag'].filter(Boolean).join(' '),
    title: pinned ? 'Columna fija al inicio' : `${c.title ? `${c.title}\n` : ''}Arrastre para reordenar`,
    draggable: pinned ? undefined : 'true',
    'data-col': c.id,
  }, c.label);
  if (pinned) return th;
  th.addEventListener('dragstart', (e) => {
    dragCol = c.id;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', c.id); } catch { /* algunos navegadores */ }
    th.classList.add('dragging');
  });
  th.addEventListener('dragend', () => { dragCol = null; $$('#results-head th').forEach((x) => x.classList.remove('dragging', 'drop-before', 'drop-after')); });
  th.addEventListener('dragover', (e) => {
    if (!dragCol || dragCol === c.id) return;
    e.preventDefault();
    const after = e.offsetX > th.offsetWidth / 2;
    th.classList.toggle('drop-after', after);
    th.classList.toggle('drop-before', !after);
  });
  th.addEventListener('dragleave', () => th.classList.remove('drop-before', 'drop-after'));
  th.addEventListener('drop', (e) => {
    e.preventDefault();
    const after = th.classList.contains('drop-after');
    const id = dragCol;
    dragCol = null;
    if (id) moveColumn(id, c.id, after);
  });
  return th;
}

$('#btn-reset-cols').addEventListener('click', () => { writeSavedOrder(null); renderResults(); toast('Orden de columnas restablecido.'); });

// ---------------------------------------------------------------------------
// Confirmación manual («chulito»)
// ---------------------------------------------------------------------------
/** Estado que ve el usuario: una confirmación manual válida cuenta como CORRECTO. */
function effStatus(item) {
  return item.manual ? E.STATUS.CORRECTO : item.result.status;
}

function itemRecord(item) {
  const get = (n) => { const i = extraIndex(n); return i >= 0 && item.source === 'excel' ? item.extra?.[i] ?? '' : ''; };
  return { lote: get('LOTE'), nit: get('NIT'), ...item.input };
}

/**
 * Aplica confirmaciones guardadas solo si es el MISMO registro (Lote + NIT + nombres)
 * y la novedad sigue siendo la misma que se confirmó. Si cambió, no se asume nada.
 */
function applyConfirmations(items) {
  let applied = 0, stale = 0;
  for (const item of items) {
    item.manual = null;
    item.staleConf = null;
    if (!E.CONFIRMABLE.has(item.result.status)) continue;
    const key = E.recordKey(itemRecord(item));
    const conf = state.confs.get(key);
    if (!conf || conf.key !== key) continue;
    if (conf.sig === E.issueSignature(item.result)) { item.manual = conf; applied++; }
    else { item.staleConf = conf; stale++; }
  }
  return { applied, stale };
}

function actionCell(item, isOpen) {
  const td = h('td', { class: 'col-action' });
  const wrap = h('div', { class: 'action-wrap' });
  const can = E.CONFIRMABLE.has(item.result.status);
  if (can) {
    const on = !!item.manual;
    const busy = state.saving.has(item.id);
    const btn = h('button', {
      type: 'button', class: `check-btn${on ? ' on' : ''}${item.staleConf ? ' stale' : ''}`,
      'aria-pressed': String(on), disabled: busy || undefined,
      'aria-label': on ? 'Desmarcar: volver a la novedad original' : 'Marcar como gestionado',
      title: on ? `Gestionado por ${item.manual.byEmail || '—'} · ${fmtDate(item.manual.at)}\nClic para desmarcar`
        : item.staleConf ? 'Hubo una confirmación anterior, pero la novedad cambió. Revise antes de marcar.' : 'Marcar como gestionado (pasa a Correctos)',
    });
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggleConfirmation(item); });
    btn.addEventListener('keydown', (e) => e.stopPropagation());
    wrap.append(btn);
  } else {
    wrap.append(h('span', { class: 'check-placeholder' }));
  }
  wrap.append(hasDetail(item) ? h('span', { class: 'chev', text: '›' }) : h('span', { class: 'chev chev-empty' }));
  td.append(wrap);
  return td;
}

async function toggleConfirmation(item) {
  if (state.saving.has(item.id)) return;
  const turnOn = !item.manual;
  const key = E.recordKey(itemRecord(item));
  const sig = E.issueSignature(item.result);
  const prevConf = state.confs.get(key);
  const prevManual = item.manual;
  state.saving.add(item.id);
  // Respuesta inmediata en pantalla; si falla el guardado se revierte.
  const optimistic = { key, sig, active: true, originalStatus: item.result.status, byEmail: state.user?.email, at: new Date() };
  if (turnOn) state.confs.set(key, optimistic); else state.confs.delete(key);
  applyConfirmations(state.results);
  renderResults();
  try {
    const saved = await D.setConfirmation({
      key, sig, active: turnOn, record: itemRecord(item), originalStatus: item.result.status,
      fileName: item.source === 'excel' ? state.lastFileName : null, remixVersion: state.meta?.activeVersion,
    });
    if (turnOn) state.confs.set(key, saved);
    toast(turnOn ? 'Marcado como gestionado. Pasó a Correctos.' : `Desmarcado. Volvió a «${item.result.status}».`);
  } catch (err) {
    if (prevConf) state.confs.set(key, prevConf); else state.confs.delete(key);
    item.manual = prevManual;
    toast(friendlyError(err), true);
  } finally {
    state.saving.delete(item.id);
    applyConfirmations(state.results);
    renderResults();
  }
}

// ---------------------------------------------------------------------------
// Sesión de trabajo: los resultados sobreviven a recargar la página (por usuario, en este navegador).
// ---------------------------------------------------------------------------
const SESSION_STORE = 'cg-remix-session-v1';

function saveSession() {
  try {
    if (!state.results.length) { localStorage.removeItem(SESSION_STORE); return; }
    localStorage.setItem(SESSION_STORE, JSON.stringify({
      uid: state.user?.uid, fileName: state.lastFileName, extraHeaders: state.extraHeaders,
      items: state.results.map(({ source, sourceRow, input, extra }) => ({ source, sourceRow, input, extra })),
    }));
  } catch { /* sin almacenamiento: se trabaja solo en memoria */ }
}

function restoreSession() {
  if (!state.index || state.results.length) return;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SESSION_STORE) || 'null'); } catch { saved = null; }
  if (!saved || saved.uid !== state.user?.uid || !Array.isArray(saved.items) || !saved.items.length) return;
  state.extraHeaders = saved.extraHeaders || [];
  state.lastFileName = saved.fileName || null;
  state.results = saved.items.map((x) => ({
    id: ++seq, source: x.source, sourceRow: x.sourceRow, extra: x.extra || [], input: x.input,
    result: E.validateRecord(state.index, state.eq, x.input),
  }));
  applyConfirmations(state.results);
  renderResults();
}

function renderSummary() {
  const el = $('#summary');
  el.hidden = !state.results.length;
  if (!state.results.length) return;
  el.replaceChildren(...CATS.map((c) => {
    const n = state.results.filter((x) => c.match(x)).length;
    const manual = c.key === 'correcto' ? state.results.filter((x) => x.manual).length : 0;
    return h('button', {
      type: 'button', class: `stat ${c.cls}${state.filter === c.key ? ' active' : ''}${n ? '' : ' empty'}`,
      'data-filter': c.key, 'aria-pressed': String(state.filter === c.key), title: `Filtrar: ${c.label}`,
    }, h('div', { class: 'stat-n' }, String(n), manual ? ' ' : null, manual ? h('span', { class: 'stat-sub', text: `${manual} manual${manual > 1 ? 'es' : ''}` }) : null),
    h('div', { class: 'stat-l', text: c.label }));
  }));
}

/** Campos con una sugerencia que el usuario puede confirmar o descartar. */
function decisionFields(item) {
  if (item.manual) return [];
  return E.FIELDS.map(({ key }) => key).filter((key) => {
    const f = item.result.fields[key];
    return f.status === 'revisar' || (f.status === 'no_encontrado' && f.closest);
  });
}
const hasDetail = (item) => decisionFields(item).length > 0;

function renderDetail(item) {
  const grid = h('div', { class: 'detail-grid' });
  for (const key of decisionFields(item)) grid.append(renderFieldBox(item, key, VIEW_LABEL[key]));
  return grid;
}

function renderFieldBox(item, key, label) {
  const f = item.result.fields[key];
  const box = h('div', { class: 'fbox' },
    h('div', { class: 'fbox-title', text: label }),
    h('div', { class: 'fbox-input', text: item.input[key] || '(vacío)' }));

  const statusLine = {
    exacto: 'Coincide con REMIX.',
    equivalencia: f.reason,
    revisar: f.reason,
    no_encontrado: f.reason,
    vacio: 'Campo vacío.',
  }[f.status];
  const special = f.label === 'NUEVO PROVEEDOR' ? 'np' : f.label === 'VALIDAR CLIENTE' ? 'vc' : null;
  box.append(h('p', {},
    h('span', { class: `badge ${special || DOT[f.status]}`, text: f.label || (f.status === 'exacto' ? 'CORRECTO' : f.status === 'vacio' ? 'VACÍO' : '') }),
    ' ', special ? f.reason : statusLine));

  const cands = f.status === 'revisar' ? f.candidates.slice(0, 3)
    : f.status === 'no_encontrado' && f.closest ? [{ ...f.closest, kind: 'lejana' }] : [];
  for (const c of cands) box.append(renderCandidate(item, key, c));
  if (f.status === 'revisar' && f.totalCandidates > 3) {
    box.append(h('p', { class: 'small', text: `Hay ${f.totalCandidates - 3} coincidencias posibles más. Escriba el nombre más completo para afinar.` }));
  }
  return box;
}

function renderCandidate(item, key, c) {
  const input = item.input[key];
  const pairKeyStr = [E.compactKey(input), c.compact].sort().join('|');
  const localKey = `${key}|${pairKeyStr}`;
  const tag = c.kind === 'lejana' ? 'sugerencia de baja confianza' : (E.KIND_LABEL[c.kind] || '').toLowerCase();

  const el = h('div', { class: 'cand' },
    h('div', {}, h('span', { class: 'cand-name', text: c.display }),
      h('span', { class: 'cand-tag', text: tag }),
      c.completesRelation ? h('span', { class: 'cand-tag', text: '· completa la relación' }) : null));

  if (state.localPending.has(localKey)) {
    el.append(h('div', { class: 'small muted', style: 'margin:6px 0 0', text: 'Marcado como pendiente.' }));
  }
  const actions = h('div', { class: 'cand-actions' },
    h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: (e) => decide(e, item, key, c, 'misma'), text: 'Son la misma entidad' }),
    h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: (e) => decide(e, item, key, c, 'diferente'), text: 'Son diferentes' }),
    h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: (e) => { e.stopPropagation(); state.localPending.add(localKey); renderResults(); }, text: 'Dejar pendiente' }));
  el.append(actions);
  return el;
}

async function decide(e, item, key, cand, decision) {
  e.stopPropagation();
  const input = item.input[key];
  const label = fieldLabel(key);
  const msg = decision === 'misma'
    ? `¿Confirmar que «${input}» y «${cand.display}» son la MISMA entidad en ${label}?\nSe aplicará a todos los usuarios.`
    : `¿Confirmar que «${input}» y «${cand.display}» son entidades DIFERENTES?\nNo volverá a sugerirse.`;
  if (!confirm(msg)) return;
  e.target.disabled = true;
  try {
    const id = E.equivalenceId(key, input, cand.display);
    const existing = state.eqDocs.some((d) => d.id === id);
    await D.decideEquivalence({ field: key, input, remixName: cand.display, decision, existing });
    await loadEquivalences();
    revalidateAll();
    toast('Decisión guardada y aplicada para todos.');
  } catch (err) {
    toast(friendlyError(err), true);
    e.target.disabled = false;
  }
}

function revalidateAll() {
  if (!state.index) return;
  for (const item of state.results) item.result = E.validateRecord(state.index, state.eq, item.input);
  applyConfirmations(state.results);
  renderResults();
}

// ---------------------------------------------------------------------------
// Exportación a Excel
// ---------------------------------------------------------------------------
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

function writeBook(sheets, filename) {
  const wb = XLSX.utils.book_new();
  for (const { name, rows, widths } of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = xw(widths).slice(0, rows[0].length).map((w) => ({ wch: w }));
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length - 1, 0), c: rows[0].length - 1 } }) };
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  XLSX.writeFile(wb, filename);
}

const origin = (item) => item.sourceRow ?? 'manual';
// Columnas adicionales del informe al final de cada hoja.
const xh = () => state.extraHeaders;
const asCell = (v) => (/^-?\d+(\.\d+)?$/.test(v) && v.length < 16 && !/^0\d/.test(v) ? Number(v) : v);
const xv = (item) => xh().map((_, i) => asCell(item.extra?.[i] ?? ''));
const xw = (widths) => [...widths, ...xh().map(() => 18)];

const fr = (item) => item.result.facturadorRemix || '';

function warningRows(items) {
  const rows = [['Cliente de planta', 'Facturador', 'Facturador (REMIX)', 'Proveedor', 'Campo con diferencia', 'Nombre en REMIX', 'Advertencia', ...xh()]];
  for (const item of items) {
    for (const w of item.result.warnings) {
      rows.push([item.input.cliente, item.input.facturador, fr(item), item.input.proveedor, w.campo, w.nombreRemix, w.mensaje, ...xv(item)]);
    }
  }
  return rows;
}

function resultRows(items) {
  const rows = [['Fila origen', 'Cliente de planta', 'Facturador', 'Facturador (REMIX)', 'Proveedor', 'Resultado', 'Tipo de correcto', 'Validación REMIX', 'Detalle', 'Nombre sugerido en REMIX', 'Relación en REMIX', 'Confirmado por', 'Fecha confirmación', ...xh()]];
  for (const item of items) {
    const r = item.result;
    const base = r.baseStatus || r.status;
    const st = effStatus(item);
    const tipo = item.manual ? 'Confirmación manual' : st === E.STATUS.CORRECTO ? (r.viaEquivalence ? 'Automático (equivalencia)' : 'Automático') : '';
    rows.push([
      origin(item), item.input.cliente, item.input.facturador, fr(item), item.input.proveedor, st, tipo, base,
      base === E.STATUS.CORRECTO ? (r.viaEquivalence ? 'Correcto por equivalencia aprobada' : '') : r.warnings.map((w) => w.mensaje).join(' | '),
      suggestions(r).join(' | '),
      r.remix ? `${r.remix.cliente} → ${r.remix.facturador} → ${r.remix.proveedor}` : '',
      item.manual?.byEmail || '', item.manual ? fmtDate(item.manual.at) : '',
      ...xv(item),
    ]);
  }
  return rows;
}

function newProviderRows(items) {
  const rows = [['Fila origen', 'Cliente de planta', 'Facturador', 'Facturador (REMIX)', 'Proveedor nuevo', '¿Existe en REMIX?', 'Proveedores ya registrados para este cliente y facturador', ...xh()]];
  for (const item of items) {
    const p = item.result.fields.proveedor;
    rows.push([origin(item), item.input.cliente, item.input.facturador, fr(item), item.input.proveedor,
      p.status === 'no_encontrado' ? `No${p.closest ? ` (parecido: ${p.closest.display})` : ''}` : 'Sí, con otro cliente o facturador',
      (item.result.newProviderKnown || []).join('; '), ...xv(item)]);
  }
  return rows;
}

function validateClientRows(items) {
  const rows = [['Fila origen', 'Cliente de planta', 'Facturador', 'Facturador (REMIX)', 'Proveedor', '¿Cliente existe en REMIX?', 'Clientes registrados con este facturador y proveedor', 'Acción', ...xh()]];
  for (const item of items) {
    const c = item.result.fields.cliente;
    const known = item.result.warnings.find((w) => w.mensaje.startsWith('VALIDAR CLIENTE'))?.nombreRemix.replace(/^[^:]+:\s*/, '') || '';
    rows.push([origin(item), item.input.cliente, item.input.facturador, fr(item), item.input.proveedor,
      c.status === 'no_encontrado' ? `No${c.closest ? ` (parecido: ${c.closest.display})` : ''}` : 'Sí',
      known, 'Validar que el facturador corresponda a este cliente', ...xv(item)]);
  }
  return rows;
}

const W_NEW = [10, 30, 30, 30, 32, 30, 70];
const W_CLI = [10, 30, 30, 30, 30, 26, 60, 46];
const W_RES = [10, 30, 30, 30, 30, 26, 22, 26, 70, 40, 60, 28, 20];
const W_WARN_FULL = [30, 30, 30, 30, 26, 40, 80];

$('#btn-show-all').addEventListener('click', () => { state.filter = 'todos'; renderResults(); });

// El Excel exporta exactamente lo que se ve con el filtro activo.
$('#btn-export').addEventListener('click', () => {
  const cat = currentCat();
  const items = visibleResults();
  if (!items.length) { toast('No hay registros para exportar.'); return; }
  const by = (st) => items.filter((x) => effStatus(x) === st);
  const slug = cat.key === 'todos' ? 'todos' : cat.label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_');
  let sheets;
  switch (cat.key) {
    case 'todos': {
      sheets = [{ name: 'Resultados', rows: resultRows(items), widths: W_RES }];
      const np = by(E.STATUS.NUEVO_PROVEEDOR);
      const vc = by(E.STATUS.VALIDAR_CLIENTE);
      const warn = items.filter((x) => [E.STATUS.REVISAR, E.STATUS.NO_ENCONTRADO, E.STATUS.RELACION].includes(effStatus(x)));
      const manual = items.filter((x) => x.manual);
      if (np.length) sheets.push({ name: 'Nuevos proveedores', rows: newProviderRows(np), widths: W_NEW });
      if (vc.length) sheets.push({ name: 'Validar cliente', rows: validateClientRows(vc), widths: W_CLI });
      const cg = by(E.STATUS.CENTRAL);
      if (cg.length) sheets.push({ name: 'Central Ganadera', rows: resultRows(cg), widths: W_RES });
      if (warn.length) sheets.push({ name: 'Advertencias', rows: warningRows(warn), widths: W_WARN_FULL });
      if (manual.length) sheets.push({ name: 'Confirmados manualmente', rows: resultRows(manual), widths: W_RES });
      break;
    }
    case 'correcto': sheets = [{ name: 'Correctos', rows: resultRows(items), widths: W_RES }]; break;
    case 'central': sheets = [{ name: 'Central Ganadera', rows: resultRows(items), widths: W_RES }]; break;
    case 'nuevo': sheets = [{ name: 'Nuevos proveedores', rows: newProviderRows(items), widths: W_NEW }]; break;
    case 'cliente': sheets = [{ name: 'Validar cliente', rows: validateClientRows(items), widths: W_CLI }]; break;
    default: sheets = [{ name: cat.label.slice(0, 31), rows: warningRows(items), widths: W_WARN_FULL }];
  }
  writeBook(sheets, `REMIX_${slug}_${stamp()}.xlsx`);
});

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------
const dlg = $('#settings');
$('#open-settings').addEventListener('click', () => {
  dlg.showModal();
  selectTab('remix');
});
$('#close-settings').addEventListener('click', () => dlg.close());
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
$('#settings-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b) selectTab(b.dataset.tab);
});

function selectTab(tab) {
  for (const b of $$('#settings-tabs button')) b.classList.toggle('active', b.dataset.tab === tab);
  for (const p of $$('[data-panel]')) p.hidden = p.dataset.panel !== tab;
  if (tab === 'remix') renderRemixPanel();
  if (tab === 'equivalencias') renderEqAdmin();
}

// ---- REMIX ----
async function renderRemixPanel() {
  const m = state.meta;
  $('#remix-current').replaceChildren(m
    ? h('div', {}, h('strong', { text: 'Versión activa: ' }), `${m.fileName || m.activeVersion} · ${m.rowCount?.toLocaleString('es-CO')} relaciones · ${fmtDate(m.updatedAt)} · ${m.updatedByEmail || ''}`)
    : h('div', { text: 'No hay una versión de REMIX cargada.' }));
  renderRemixReview();
  const listEl = $('#remix-versions');
  listEl.replaceChildren(h('div', { class: 'muted small', text: 'Cargando…' }));
  try {
    const versions = await D.listRemixVersions();
    listEl.replaceChildren(...(versions.length ? versions.map((v) => {
      const active = v.id === state.meta?.activeVersion;
      return h('div', { class: 'list-item' },
        h('div', {}, h('div', { text: v.fileName || v.id }),
          h('div', { class: 'meta', text: `${fmtDate(v.createdAt)} · ${v.rowCount} filas · ${v.createdByEmail || ''}${v.status !== 'completa' ? ' · INCOMPLETA' : ''}` })),
        active ? h('span', { class: 'chip', text: 'Activa' })
          : v.status === 'completa' ? h('button', { class: 'btn btn-secondary btn-sm', text: 'Reactivar', onClick: () => reactivate(v) }) : null);
    }) : [h('div', { class: 'muted small', text: 'Sin versiones.' })]));
  } catch (err) {
    listEl.replaceChildren(h('div', { class: 'form-error', text: friendlyError(err) }));
  }
}

async function reactivate(v) {
  if (!confirm(`¿Reactivar la versión «${v.fileName || v.id}» (${v.rowCount} filas)? La versión actual se conserva.`)) return;
  try {
    await D.activateRemixVersion(v.id, state.meta?.activeVersion, { rowCount: v.rowCount, fileName: v.fileName });
    await loadData();
    revalidateAll();
    renderRemixPanel();
    toast('Versión reactivada.');
  } catch (err) { toast(friendlyError(err), true); }
}

$('#remix-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const parsed = await readSheetFile(file, 'remix');
    if (!parsed.rows.length) throw new Error('El archivo REMIX no tiene registros.');
    const newIndex = E.buildIndex(parsed.rows);
    state.remixDraft = {
      rows: parsed.rows.map(({ cliente, facturador, proveedor, facturadorRemix }) => ({ cliente, facturador, proveedor, facturadorRemix: facturadorRemix || '' })),
      fileName: file.name, sheet: parsed.sheet, newIndex,
      factHeader: parsed.headerNames?.facturadorRemix || '',
      factFilled: parsed.rows.filter((r) => r.facturadorRemix).length,
      allHeaders: parsed.allHeaders || [],
    };
    renderRemixReview();
  } catch (err) { toast(friendlyError(err), true); }
});

function equivalenceItems() {
  const map = new Map();
  for (const s of E.SEED_EQUIVALENCES) {
    const id = E.equivalenceId(s.field, s.a, s.b);
    map.set(id, { ...s, id, status: 'aprobada', seed: true, persisted: false });
  }
  for (const d of state.eqDocs) map.set(d.id, { ...(map.get(d.id) || {}), ...d, persisted: true });
  return [...map.values()];
}

function staleCheck(index, items) {
  return items.filter((x) => x.status === 'aprobada').map((x) => {
    const fi = index.fields[x.field];
    const stale = !(fi.byCompact.has(E.compactKey(x.a)) || fi.byCompact.has(E.compactKey(x.b)));
    return { ...x, stale };
  });
}

function renderRemixReview() {
  const box = $('#remix-review');
  const d = state.remixDraft;
  if (!d) { box.replaceChildren(); return; }
  const idx = d.newIndex;
  const incomplete = d.rows.filter((r) => !r.cliente || !r.facturador || !r.proveedor).length;
  const duplicates = d.rows.length - idx.triples.size - incomplete;
  let added = 0, removed = 0;
  if (state.index) {
    for (const t of idx.triples) if (!state.index.triples.has(t)) added++;
    for (const t of state.index.triples) if (!idx.triples.has(t)) removed++;
  }
  const eqCheck = staleCheck(idx, equivalenceItems());
  const stale = eqCheck.filter((x) => x.stale);
  const shrink = state.index && d.rows.length < state.index.rowCount * 0.5;

  const ul = h('ul', {},
    h('li', { text: `${d.rows.length.toLocaleString('es-CO')} filas (hoja «${d.sheet}») · ${idx.triples.size.toLocaleString('es-CO')} relaciones completas distintas` }),
    h('li', { text: 'Se validan las columnas «Cliente de planta», «Facturar a Nombre de» (como facturador) y «Proveedor».' }),
    h('li', { class: d.factHeader && d.factFilled ? '' : 'warn', text: !d.factHeader
      ? `No se encontró la columna «Facturador» en este REMIX: FACTURADOR (REMIX) quedará vacía. Encabezados del archivo: ${d.allHeaders.join(' · ')}`
      : d.factFilled
        ? `Columna «${d.factHeader}» → FACTURADOR (REMIX), con dato en ${d.factFilled.toLocaleString('es-CO')} de ${d.rows.length.toLocaleString('es-CO')} filas. Solo de lectura: no se usa para validar.`
        : `La columna «${d.factHeader}» existe pero está vacía en todas las filas.` }),
    h('li', { text: `Nombres distintos: ${idx.fields.cliente.entries.length} clientes · ${idx.fields.facturador.entries.length} facturadores · ${idx.fields.proveedor.entries.length} proveedores` }),
    incomplete ? h('li', { class: 'warn', text: `${incomplete} filas con alguna celda vacía (sus nombres cuentan, pero no forman relación).` }) : null,
    duplicates > 0 ? h('li', { text: `${duplicates} filas repetidas (no afectan la validación).` }) : null,
    state.index ? h('li', { text: `Frente a la versión activa: +${added} relaciones nuevas · −${removed} relaciones que ya no estarán.` }) : null,
    h('li', { class: stale.length ? 'warn' : '', text: stale.length
      ? `${stale.length} equivalencias aprobadas quedarían sin nombre en REMIX: ${stale.map((s) => `${s.a} ⇄ ${s.b}`).join('; ')}.`
      : `Las ${eqCheck.length} equivalencias aprobadas siguen siendo válidas.` }),
    shrink ? h('li', { class: 'bad', text: 'El archivo nuevo tiene menos de la mitad de filas que la versión activa. Verifique que sea el archivo correcto.' }) : null,
  );
  const publish = h('button', { class: 'btn btn-primary', text: 'Publicar y activar', onClick: () => publishRemix(publish, eqCheck) });
  box.replaceChildren(h('div', { class: 'review' },
    h('strong', { text: d.fileName }), ul,
    h('div', { class: 'row-gap' }, publish,
      h('button', { class: 'btn btn-ghost', text: 'Cancelar', onClick: () => { state.remixDraft = null; renderRemixReview(); } }))));
}

async function publishRemix(btn, eqCheck) {
  const d = state.remixDraft;
  if (!d) return;
  btn.disabled = true;
  btn.textContent = 'Publicando…';
  try {
    const versionId = await D.saveRemixVersion(d.rows, d.fileName);
    await D.activateRemixVersion(versionId, state.meta?.activeVersion, { rowCount: d.rows.length, fileName: d.fileName });
    await D.markEquivalencesStale(eqCheck, versionId);
    state.remixDraft = null;
    await loadData();
    revalidateAll();
    renderRemixPanel();
    toast('Nueva versión de REMIX publicada y activa.');
  } catch (err) {
    toast(friendlyError(err), true);
    btn.disabled = false;
    btn.textContent = 'Publicar y activar';
  }
}

// ---- Equivalencias ----
function renderEqAdmin() {
  const items = equivalenceItems();
  const staleIds = new Set(state.index ? staleCheck(state.index, items).filter((x) => x.stale).map((x) => x.id) : []);
  const groups = [
    ['aprobada', 'Aprobadas (misma entidad)'],
    ['rechazada', 'Descartadas (entidades diferentes)'],
    ['revertida', 'Revertidas'],
  ];
  const root = $('#eq-admin');
  root.replaceChildren();
  for (const [status, title] of groups) {
    const list = items.filter((x) => x.status === status);
    root.append(h('h3', { class: 'h4', text: `${title} · ${list.length}` }));
    if (!list.length) { root.append(h('div', { class: 'muted small', text: 'Ninguna.' })); continue; }
    const wrap = h('div', { class: 'list' });
    for (const x of list) {
      const who = x.seed && !x.history ? 'Confirmada en la especificación'
        : `${x.decidedByEmail || '—'} · ${fmtDate(x.decidedAt)}`;
      const btns = status === 'revertida'
        ? [h('button', { class: 'btn btn-secondary btn-sm', text: 'Aprobar', onClick: () => setEq(x, 'aprobada') }),
          h('button', { class: 'btn btn-secondary btn-sm', text: 'Descartar', onClick: () => setEq(x, 'rechazada') })]
        : [h('button', { class: 'btn btn-ghost btn-sm', text: 'Revertir', onClick: () => setEq(x, 'revertida') })];
      wrap.append(h('div', { class: 'list-item' },
        h('div', {},
          h('div', {}, h('strong', { text: x.a }), ' ⇄ ', h('strong', { text: x.b })),
          h('div', { class: 'meta', text: `${fieldLabel(x.field)} · ${who}` }),
          staleIds.has(x.id) ? h('div', { class: 'stale', text: 'Ningún lado existe en la versión actual de REMIX' }) : null),
        h('div', { class: 'row-gap' }, ...btns)));
    }
    root.append(wrap);
  }
}

async function setEq(item, status) {
  const verb = { aprobada: 'aprobar', rechazada: 'descartar', revertida: 'revertir' }[status];
  if (!confirm(`¿Desea ${verb} «${item.a} ⇄ ${item.b}» (${fieldLabel(item.field)})? Afecta a todos los usuarios.`)) return;
  try {
    await D.setEquivalenceStatus(item, status);
    await loadEquivalences();
    revalidateAll();
    renderEqAdmin();
    toast('Equivalencia actualizada.');
  } catch (err) { toast(friendlyError(err), true); }
}
