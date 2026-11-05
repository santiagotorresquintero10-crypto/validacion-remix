// ============================================================================
// Central Ganadera — Motor de validación REMIX
// Módulo puro (sin DOM ni Firebase) para poder probarlo de forma aislada.
//
// Principios:
//  1. Cada campo se compara SOLO contra su propia columna de REMIX.
//  2. Una relación es válida SOLO si los tres nombres aparecen en la MISMA fila.
//  3. Lo único que se acepta automáticamente como correcto son diferencias de
//     mayúsculas, tildes, espacios y puntuación, o equivalencias APROBADAS.
//     Cualquier parecido (ortografía, abreviatura, nombre incompleto) va a REVISAR.
// ============================================================================

export const FIELDS = [
  { key: 'cliente', label: 'Cliente de planta' },
  { key: 'facturador', label: 'Facturador' },
  { key: 'proveedor', label: 'Proveedor' },
];

export const STATUS = {
  CORRECTO: 'CORRECTO',
  NUEVO_PROVEEDOR: 'NUEVO PROVEEDOR',
  VALIDAR_CLIENTE: 'VALIDAR CLIENTE',
  REVISAR: 'REVISAR',
  NO_ENCONTRADO: 'NO ENCONTRADO',
  RELACION: 'RELACIÓN NO REGISTRADA',
  CENTRAL: 'PROVEEDOR CENTRAL GANADERA',
};
// Compatibilidad: una equivalencia aprobada con relación válida es simplemente CORRECTO.
STATUS.EQUIV = STATUS.CORRECTO;

// Equivalencias confirmadas en la especificación (Facturador).
// Se tratan como aprobadas salvo que el administrador las revierta en Firebase.
export const SEED_EQUIVALENCES = [
  { field: 'facturador', a: 'SANDRA MILENA LOPEZ OSORIO', b: 'SANDRA MILENA LOPEZ' },
  { field: 'facturador', a: 'AGROFAR SAS', b: 'AGROFAR' },
];

// Palabras sin peso para decidir identidad.
const STOPWORDS = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'Y', 'E', 'EN', 'POR', 'PARA']);
const LEGAL_SUFFIXES = new Set(['SAS', 'SA', 'LTDA', 'BIC', 'EU', 'SCA', 'SC', 'CIA', 'ESP', 'SEN', 'C', 'S']);

// ---------------------------------------------------------------------------
// Normalización
// ---------------------------------------------------------------------------
export function normalize(value) {
  let s = String(value ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/&/g, ' Y ')
    .replace(/[.'’‘´`"]/g, '')          // S.A.S. -> SAS (se eliminan sin separar)
    .replace(/[^A-Z0-9]+/g, ' ')         // resto de puntuación -> espacio
    .trim();
  if (!s) return '';
  // Une iniciales sueltas consecutivas: "S A S" -> "SAS"
  const out = [];
  let run = '';
  for (const t of s.split(' ')) {
    if (t.length === 1 && /[A-Z]/.test(t)) run += t;
    else { if (run) { out.push(run); run = ''; } out.push(t); }
  }
  if (run) out.push(run);
  return out.join(' ');
}

export const compactKey = (value) => normalize(value).replace(/ /g, '');
export const normalizeHeader = (h) => compactKey(h);

// ---------------------------------------------------------------------------
// Utilidades de similitud
// ---------------------------------------------------------------------------
function osaDistance(a, b) {
  const n = a.length, m = b.length;
  if (!n) return m; if (!m) return n;
  const d = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[n][m];
}

function allowedEdits(len) {
  if (len <= 3) return 0;
  if (len <= 6) return 1;
  return 2;
}

// 'eq' | 'near' (error de ortografía) | 'abbr' (prefijo/abreviatura) | 'diff'
const relCache = new Map();
function tokenRelation(a, b) {
  if (a === b) return 'eq';
  const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
  const hit = relCache.get(key);
  if (hit) return hit;
  let out = 'diff';
  if (!(/\d/.test(a) || /\d/.test(b))) { // nunca "corregir" números
    const allowed = allowedEdits(Math.min(a.length, b.length));
    const [s, l] = a.length < b.length ? [a, b] : [b, a];
    if (l.length - s.length <= allowed && osaDistance(a, b) <= allowed) out = 'near';
    else if (l.startsWith(s)) out = 'abbr';
  }
  if (relCache.size > 200000) relCache.clear();
  relCache.set(key, out);
  return out;
}

// "JC" frente a JUAN CARLOS: iniciales de palabras consecutivas
function initialsSpan(token, L, j) {
  if (token.length < 2 || token.length > 4 || !/^[A-Z]+$/.test(token)) return 0;
  if (j + token.length > L.length) return 0;
  for (let k = 0; k < token.length; k++) if (L[j + k][0] !== token[k]) return 0;
  return token.length;
}

function trigrams(s) {
  const p = `  ${s} `;
  const g = new Map();
  for (let i = 0; i < p.length - 2; i++) {
    const t = p.slice(i, i + 3);
    g.set(t, (g.get(t) || 0) + 1);
  }
  return g;
}

function dice(a, b) {
  if (!a || !b) return 0;
  const ga = typeof a === 'string' ? trigrams(a) : a;
  const gb = typeof b === 'string' ? trigrams(b) : b;
  let inter = 0, ta = 0, tb = 0;
  for (const v of ga.values()) ta += v;
  for (const v of gb.values()) tb += v;
  for (const [k, v] of ga) if (gb.has(k)) inter += Math.min(v, gb.get(k));
  return (2 * inter) / (ta + tb);
}

// ---------------------------------------------------------------------------
// Índice REMIX
// ---------------------------------------------------------------------------
const tripleKey = (c, f, p) => `${c}|${f}|${p}`;
const pairKey = (a, b) => `${a}|${b}`;

/**
 * rows: [{ cliente, facturador, proveedor }] tal como vienen de REMIX.
 */
export function buildIndex(rows) {
  const fields = {};
  for (const { key } of FIELDS) fields[key] = { byCompact: new Map(), entries: [], df: new Map(), vocab: new Map(), commonDf: 5 };

  const triples = new Set();
  const pairs = { cf: new Set(), cp: new Set(), fp: new Set() };
  const byCliente = new Map();
  const byFP = new Map();
  const factByTriple = new Map();
  const cpRows = new Map();      // par Cliente+Proveedor → [{ f, x }] (f = Facturar a Nombre de, x = Facturador)
  const clientsByProv = new Map();
  const factByCF = new Map();
  let hasFacturadorRemix = false;
  const addFact = (map, key, raw) => {
    const v = String(raw ?? '').trim().replace(/\s+/g, ' ');
    if (!v) return;
    hasFacturadorRemix = true;
    if (!map.has(key)) map.set(key, new Map());
    const m = map.get(key);
    const ck = compactKey(v);
    if (!m.has(ck)) m.set(ck, v);
  };

  const addName = (fieldKey, raw) => {
    const norm = normalize(raw);
    if (!norm) return '';
    const ck = norm.replace(/ /g, '');
    const fi = fields[fieldKey];
    let e = fi.byCompact.get(ck);
    if (!e) {
      e = { compact: ck, norm, tokens: norm.split(' '), raws: new Map() };
      fi.byCompact.set(ck, e);
      fi.entries.push(e);
    }
    const r = String(raw).trim().replace(/\s+/g, ' ');
    e.raws.set(r, (e.raws.get(r) || 0) + 1);
    return ck;
  };

  for (const row of rows) {
    const c = addName('cliente', row.cliente);
    const f = addName('facturador', row.facturador);
    const p = addName('proveedor', row.proveedor);
    if (c && f && p) {
      triples.add(tripleKey(c, f, p));
      if (!byCliente.has(c)) byCliente.set(c, []);
      byCliente.get(c).push({ f, p });
      const fpk = pairKey(f, p);
      if (!byFP.has(fpk)) byFP.set(fpk, []);
      byFP.get(fpk).push(c);
      addFact(factByTriple, tripleKey(c, f, p), row.facturadorRemix);
    }
    if (c && p) {
      const k = pairKey(c, p);
      if (!cpRows.has(k)) cpRows.set(k, []);
      cpRows.get(k).push({ f, x: String(row.facturadorRemix ?? '').trim().replace(/\s+/g, ' ') });
      if (!clientsByProv.has(p)) clientsByProv.set(p, new Set());
      clientsByProv.get(p).add(c);
    }
    if (c && f) addFact(factByCF, pairKey(c, f), row.facturadorRemix);
    if (c && f) pairs.cf.add(pairKey(c, f));
    if (c && p) pairs.cp.add(pairKey(c, p));
    if (f && p) pairs.fp.add(pairKey(f, p));
  }

  for (const { key } of FIELDS) {
    const fi = fields[key];
    for (const e of fi.entries) {
      e.display = [...e.raws.entries()].sort((x, y) => y[1] - x[1])[0][0];
      e.grams = trigrams(e.compact);
      for (const t of new Set(e.tokens)) {
        fi.df.set(t, (fi.df.get(t) || 0) + 1);
        if (!fi.vocab.has(t)) fi.vocab.set(t, []);
        fi.vocab.get(t).push(e);
      }
    }
    // Una palabra es "común" si aparece en 5+ nombres o en el 2 % de la columna.
    fi.commonDf = Math.max(5, Math.ceil(fi.entries.length * 0.02));
  }

  return { fields, triples, pairs, byCliente, byFP, factByTriple, factByCF, cpRows, clientsByProv, hasFacturadorRemix, rowCount: rows.length };
}

export function displayName(index, fieldKey, compact) {
  return index.fields[fieldKey].byCompact.get(compact)?.display ?? compact;
}

// ---------------------------------------------------------------------------
// Equivalencias
// ---------------------------------------------------------------------------
export const equivalenceId = (field, a, b) => {
  const [x, y] = [compactKey(a), compactKey(b)].sort();
  return `${field}::${x}::${y}`;
};

/**
 * docs: [{ id, field, a, b, status }] desde Firestore.
 * status: 'aprobada' | 'rechazada' | 'propuesta' | 'revertida'
 * Las semillas aplican salvo que exista un documento con el mismo id.
 */
export function buildEquivalences(docs = [], seeds = SEED_EQUIVALENCES) {
  const byId = new Map();
  for (const s of seeds) byId.set(equivalenceId(s.field, s.a, s.b), { ...s, status: 'aprobada', seed: true });
  for (const d of docs) byId.set(d.id || equivalenceId(d.field, d.a, d.b), d);

  const approved = {}, rejected = {}, proposed = {};
  for (const { key } of FIELDS) { approved[key] = new Map(); rejected[key] = new Set(); proposed[key] = new Map(); }

  for (const d of byId.values()) {
    if (!approved[d.field]) continue;
    const a = compactKey(d.a), b = compactKey(d.b);
    if (!a || !b || a === b) continue;
    const pk = [a, b].sort().join('|');
    if (d.status === 'aprobada') {
      for (const [x, y] of [[a, b], [b, a]]) {
        if (!approved[d.field].has(x)) approved[d.field].set(x, new Set());
        approved[d.field].get(x).add(y);
      }
    } else if (d.status === 'rechazada') {
      rejected[d.field].add(pk);
    } else if (d.status === 'propuesta') {
      proposed[d.field].set(pk, d);
    }
  }
  return { approved, rejected, proposed };
}

// ---------------------------------------------------------------------------
// Comparación de nombres
// ---------------------------------------------------------------------------
const KIND_BASE = { ortografia: 0.95, orden: 0.93, abreviatura: 0.9, sufijo: 0.9, incompleto: 0.8, identidad: 0.6 };

export const KIND_LABEL = {
  ortografia: 'REVISAR ORTOGRAFÍA',
  orden: 'REVISAR ORDEN DE PALABRAS',
  abreviatura: 'REVISAR ABREVIATURA',
  sufijo: 'REVISAR NOMBRE INCOMPLETO',
  incompleto: 'REVISAR NOMBRE INCOMPLETO',
  identidad: 'VALIDAR IDENTIDAD',
};

function compareTokens(inT, cT, fi) {
  const isCommon = (t) => STOPWORDS.has(t) || (fi.df.get(t) || 0) >= fi.commonDf;

  // Mismas palabras, distinto orden
  if (inT.length === cT.length && inT.length > 1 &&
      [...inT].sort().join(' ') === [...cT].sort().join(' ')) {
    return { kind: 'orden' };
  }

  if (inT.length === cT.length) {
    const rel = inT.map((t, i) => tokenRelation(t, cT[i]));
    const diff = rel.filter((r) => r === 'diff').length;
    const near = rel.filter((r) => r === 'near').length;
    const abbr = rel.filter((r) => r === 'abbr').length;
    if (diff === 0 && near > 0) return { kind: 'ortografia' };
    if (diff === 0 && abbr > 0) return { kind: 'abreviatura' };
    if (diff > 0) {
      // Identidad dudosa: comparten palabras distintivas, pero difieren en otras.
      const strongShared = inT.filter((t, i) => rel[i] !== 'diff' && !STOPWORDS.has(t) && !isCommon(t)).length;
      const meaningful = inT.filter((t) => !STOPWORDS.has(t)).length || 1;
      const shared = inT.filter((t, i) => rel[i] !== 'diff' && !STOPWORDS.has(t)).length;
      if (strongShared >= 1 && shared / meaningful >= 0.5) return { kind: 'identidad' };
    }
    return null;
  }

  // Longitudes distintas: ¿el nombre corto está contenido (en orden) en el largo?
  const [S, L] = inT.length < cT.length ? [inT, cT] : [cT, inT];
  let j = 0;
  const used = new Set();
  let ok = true;
  for (const t of S) {
    let found = false;
    while (j < L.length) {
      const span = initialsSpan(t, L, j);
      if (span) { for (let k = 0; k < span; k++) used.add(j + k); j += span; found = true; break; }
      const r = tokenRelation(t, L[j]);
      if (r !== 'diff') { used.add(j); j++; found = true; break; }
      j++;
    }
    if (!found) { ok = false; break; }
  }
  if (ok) {
    const extra = L.filter((_, i) => !used.has(i));
    if (extra.every((t) => LEGAL_SUFFIXES.has(t))) return { kind: 'sufijo' };
    // Evita proponer como "incompleto" cuando lo compartido es solo una palabra común
    const strong = S.some((t) => !STOPWORDS.has(t) && !isCommon(t));
    if (strong || S.length >= 2) return { kind: 'incompleto' };
    return null;
  }
  return null;
}

function reasonText(kind, suggestion) {
  switch (kind) {
    case 'ortografia': return `Posible error de ortografía. En REMIX aparece «${suggestion}».`;
    case 'orden': return `Mismas palabras en distinto orden que «${suggestion}».`;
    case 'abreviatura': return `Parece una abreviatura de «${suggestion}».`;
    case 'sufijo': return `Difiere solo en la sigla societaria frente a «${suggestion}».`;
    case 'incompleto': return `Nombre incompleto o con palabras de más frente a «${suggestion}».`;
    case 'identidad': return `Nombre parecido pero no necesariamente la misma entidad que «${suggestion}». Valide la identidad.`;
    default: return '';
  }
}

// Solo se comparan nombres que comparten al menos una palabra relacionada.
function preselect(fi, inT) {
  const key = inT.filter((t) => !STOPWORDS.has(t));
  const rare = key.filter((t) => (fi.df.get(t) || 0) < fi.commonDf);
  const look = rare.length ? rare : key.length ? key : inT;
  const strong = new Set();
  const weak = new Set();
  for (const [v, list] of fi.vocab) {
    for (const t of look) {
      if (tokenRelation(t, v) !== 'diff' || (t.length <= 4 && /^[A-Z]+$/.test(t) && v[0] === t[0])) {
        const target = list.length < fi.commonDf ? strong : weak;
        for (const e of list) target.add(e);
        break;
      }
    }
  }
  // Si hay coincidencias por palabras distintivas, no se recorren las palabras comunes.
  return strong.size ? strong : weak;
}

function equivalentClosure(eqMap, start) {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const x = queue.shift();
    for (const y of eqMap.get(x) || []) if (!seen.has(y)) { seen.add(y); queue.push(y); }
  }
  seen.delete(start);
  return seen;
}

/**
 * Resuelve un valor ingresado contra UNA columna de REMIX.
 */
export function resolveField(index, eq, fieldKey, raw) {
  const fi = index.fields[fieldKey];
  const norm = normalize(raw);
  const ck = norm.replace(/ /g, '');
  if (!ck) return { status: 'vacio', input: raw ?? '', candidates: [] };

  const exact = fi.byCompact.get(ck);
  if (exact) return { status: 'exacto', input: raw, compact: ck, matches: [ck], candidates: [] };

  // Equivalencias aprobadas (con cierre transitivo)
  const alts = [...equivalentClosure(eq.approved[fieldKey], ck)].filter((x) => fi.byCompact.has(x));
  if (alts.length) {
    return { status: 'equivalencia', input: raw, compact: ck, matches: alts, candidates: [] };
  }

  const inT = norm.split(' ');
  const rejected = eq.rejected[fieldKey];
  const inGrams = trigrams(ck);
  const candidates = [];
  let rejectedHits = 0;
  for (const e of preselect(fi, inT)) {
    const cmp = compareTokens(inT, e.tokens, fi);
    if (!cmp) continue;
    if (rejected.has([ck, e.compact].sort().join('|'))) { rejectedHits++; continue; }
    const sim = dice(inGrams, e.grams);
    candidates.push({ compact: e.compact, display: e.display, kind: cmp.kind, score: KIND_BASE[cmp.kind] + 0.05 * sim, sim });
  }
  candidates.sort((a, b) => b.score - a.score || b.sim - a.sim);

  if (candidates.length) {
    return { status: 'revisar', input: raw, compact: ck, candidates: candidates.slice(0, 8), totalCandidates: candidates.length, rejectedHits };
  }

  // Sin coincidencia confiable: sugerencia más cercana si es razonable
  let best = null;
  for (const e of fi.entries) {
    if (rejected.has([ck, e.compact].sort().join('|'))) continue;
    const s = dice(inGrams, e.grams);
    if (!best || s > best.sim) best = { compact: e.compact, display: e.display, sim: s };
  }
  const closest = best && best.sim >= 0.5 ? best : null;
  return { status: 'no_encontrado', input: raw, compact: ck, candidates: [], closest, rejectedHits };
}

// ---------------------------------------------------------------------------
// Validación de un registro completo
// ---------------------------------------------------------------------------
function anyCombo(index, C, F, P) {
  for (const c of C) for (const f of F) for (const p of P) {
    if (index.triples.has(tripleKey(c, f, p))) return { c, f, p };
  }
  return null;
}

function anyPair(set, A, B) {
  for (const a of A) for (const b of B) if (set.has(pairKey(a, b))) return true;
  return false;
}

function uniq(list) { return [...new Set(list)]; }

// Proveedores registrados en REMIX para ese Cliente + Facturador
function providersFor(index, C, F) {
  const out = [];
  for (const c of C) for (const { f, p } of index.byCliente.get(c) || []) if (F.includes(f)) out.push(displayName(index, 'proveedor', p));
  return uniq(out);
}

// Clientes registrados en REMIX para ese Facturador + Proveedor
function clientsFor(index, F, P) {
  const out = [];
  for (const f of F) for (const p of P) for (const c of index.byFP.get(pairKey(f, p)) || []) out.push(displayName(index, 'cliente', c));
  return uniq(out);
}

function relationExplanation(index, C, F, P) {
  const cp = anyPair(index.pairs.cp, C, P);
  const cf = anyPair(index.pairs.cf, C, F);
  const fp = anyPair(index.pairs.fp, F, P);
  let text;
  if (cf && cp && fp) text = 'Cada par de nombres aparece en REMIX, pero nunca los tres en la misma fila.';
  else if (cp) text = 'El Cliente y el Proveedor sí están relacionados en REMIX, pero no con este Facturar a nombre de.';
  else if (cf) text = 'El Cliente y el Facturar a nombre de sí están relacionados en REMIX, pero no con este Proveedor.';
  else if (fp) text = 'El Facturar a nombre de y el Proveedor sí están relacionados en REMIX, pero no con este Cliente.';
  else text = 'Ninguna combinación de estos tres nombres aparece en REMIX.';
  const registered = [];
  for (const c of C) for (const { f, p } of index.byCliente.get(c) || []) {
    registered.push(`${displayName(index, 'facturador', f)} → ${displayName(index, 'proveedor', p)}`);
  }
  return { text, registered: uniq(registered) };
}

/**
 * input: { cliente, facturador, proveedor }
 */
/** Proveedor que contiene «Central Ganadera» (con o sin S.A., tildes o puntos). */
export function isCentralGanaderaProvider(name) {
  return compactKey(name).includes('CENTRALGANADERA');
}

// ---------------------------------------------------------------------------
// Tercera validación: «Cliente factura» (Infocgan) vs «Facturar a Nombre de» (REMIX)
// ---------------------------------------------------------------------------
/** Facturadores terceros: con ellos NO se ejecuta la tercera validación. */
export const TERCEROS = ['AGROFAR SAS', 'SANDRA MILENA LOPEZ OSORIO'];
export const CLASIF_CENTRAL = 'CENTRAL GANADERA';

export const VAL_FACT = {
  NO_APLICA: 'No aplica',
  CORRECTO: 'Correcto',
  INCONSISTENCIA: 'Inconsistencia',
  SIN_INFO: 'Sin información',
};

/**
 * Devuelve el nombre del tercero si «Cliente factura» es AGROFAR SAS o SANDRA MILENA LOPEZ OSORIO
 * (ignorando mayúsculas, tildes, espacios y puntuación, o por una equivalencia aprobada como AGROFAR = AGROFAR SAS).
 */
export function terceroFor(eq, name) {
  const ck = compactKey(name);
  if (!ck) return null;
  for (const t of TERCEROS) {
    const tk = compactKey(t);
    if (ck === tk) return t;
    if (eq && equivalentClosure(eq.approved.facturador, ck).has(tk)) return t;
  }
  return null;
}

/**
 * Valida contra REMIX.
 * - Cliente factura = AGROFAR SAS / SANDRA MILENA LOPEZ OSORIO → relación Cliente + Proveedor; tercera validación «No aplica».
 * - Cualquier otro → clasificación CENTRAL GANADERA: validación completa (como siempre) + tercera validación.
 * Si además el proveedor es Central Ganadera, se clasifica aparte conservando el resultado en baseStatus.
 */
export function validateRecord(index, eq, input) {
  const tercero = terceroFor(eq, input.facturador);
  const result = validateAgainstRemix(index, eq, input, { ignoreFacturador: !!tercero });
  result.tercero = tercero;
  result.clasificacion = tercero || CLASIF_CENTRAL;
  attachRemixInfo(index, eq, result);
  checkFacturadorRemix(eq, result);
  if (isCentralGanaderaProvider(input.proveedor)) {
    result.baseStatus = result.status;
    result.status = STATUS.CENTRAL;
  }
  return result;
}

/** A quién corresponde un valor de la columna «Facturador» de REMIX: CENTRAL GANADERA, AGROFAR SAS, SANDRA MILENA LOPEZ OSORIO o null. */
function entidadFacturador(eq, raw) {
  const k = compactKey(raw);
  if (!k) return null;
  if (k.includes('CENTRALGANADERA')) return CLASIF_CENTRAL;
  const t = terceroFor(eq, raw);
  if (t) return t;
  if (k.startsWith('AGROFAR')) return 'AGROFAR SAS';
  if (k.startsWith('SANDRAMILENALOPEZ')) return 'SANDRA MILENA LOPEZ OSORIO';
  return null;
}

/**
 * Control Facturador (REMIX) vs Facturar a nombre de (Infocgan) para terceros:
 *  REMIX CENTRAL GANADERA → Infocgan no puede ser AGROFAR SAS ni SANDRA MILENA LOPEZ OSORIO
 *  REMIX AGROFAR          → Infocgan debe ser AGROFAR SAS
 *  REMIX SANDRA MILENA LOPEZ → Infocgan debe ser SANDRA MILENA LOPEZ OSORIO
 * Si no coincide → RELACIÓN NO REGISTRADA. Otros valores de REMIX no se controlan.
 */
function checkFacturadorRemix(eq, result) {
  if (!result.tercero || result.status !== STATUS.CORRECTO || result.facturadorRemixBasis !== 'relacion') return;
  const vals = String(result.facturadorRemix || '').split(' / ').filter(Boolean);
  if (!vals.length) return;
  const ents = vals.map((v) => entidadFacturador(eq, v));
  if (ents.some((e) => e === result.tercero)) return;   // alguna fila de REMIX coincide
  if (ents.some((e) => e === null)) return;             // valor no reconocido: no se controla
  const text = `En REMIX está como ${vals.join(' / ')}, no como ${result.tercero}.`;
  result.status = STATUS.RELACION;
  result.viaEquivalence = false;
  result.valFacturar = VAL_FACT.INCONSISTENCIA;
  result.valFacturarMsg = text;
  result.notes.push(text);
  result.warnings.push({
    field: 'relacion',
    campo: 'Facturador (REMIX) vs Facturar a nombre de (Infocgan)',
    nombreRemix: result.facturadorRemix,
    mensaje: `ADVERTENCIA: RELACIÓN NO REGISTRADA EN REMIX. ${text}`,
  });
}

/** Pares Cliente+Proveedor de REMIX que corresponden a este registro. */
function remixPairs(index, result) {
  const C = result.fields.cliente, P = result.fields.proveedor;
  const certain = (r) => r.status === 'exacto' || r.status === 'equivalencia';
  if (certain(C) && certain(P)) {
    const out = [];
    for (const c of C.matches) for (const p of P.matches) if (index.cpRows.has(pairKey(c, p))) out.push(pairKey(c, p));
    if (out.length) return { keys: out, basis: 'relacion' };
  }
  const k = result.remixKeys || result.remixCP;
  if (k && index.cpRows.has(pairKey(k.c, k.p))) return { keys: [pairKey(k.c, k.p)], basis: 'sugerida' };
  return { keys: [], basis: '' };
}

/**
 * Información de REMIX para mostrar (siempre que exista) y resultado de la tercera validación.
 *  result.facturarRemix       «Facturar a Nombre de» de REMIX
 *  result.facturadorRemix     «Facturador» de REMIX (solo lectura)
 *  result.valFacturar         No aplica | Correcto | Inconsistencia | Sin información
 */
function attachRemixInfo(index, eq, result) {
  const { keys, basis } = remixPairs(index, result);
  const rows = keys.flatMap((k) => index.cpRows.get(k) || []);
  const fVals = uniq(rows.map((r) => r.f).filter(Boolean));
  const inputCk = compactKey(result.input.facturador);

  // Tercera validación
  let matched = null;
  if (result.tercero) {
    result.valFacturar = VAL_FACT.NO_APLICA;
    result.valFacturarMsg = `No aplica: Cliente factura es ${result.tercero}.`;
  } else if (basis !== 'relacion' || !fVals.length) {
    result.valFacturar = VAL_FACT.SIN_INFO;
    result.valFacturarMsg = 'Sin información en REMIX para este Cliente y Proveedor.';
  } else if (!inputCk) {
    result.valFacturar = VAL_FACT.INCONSISTENCIA;
    result.valFacturarMsg = 'Cliente factura está vacío.';
  } else {
    const alts = new Set([inputCk, ...equivalentClosure(eq.approved.facturador, inputCk)]);
    matched = fVals.find((f) => alts.has(f)) || null;
    result.valFacturar = matched ? VAL_FACT.CORRECTO : VAL_FACT.INCONSISTENCIA;
    result.valFacturarMsg = matched
      ? 'Cliente factura coincide con Facturar a Nombre de de REMIX.'
      : `Cliente factura no coincide con Facturar a Nombre de de REMIX (${fVals.map((f) => displayName(index, 'facturador', f)).join(' / ')}).`;
  }
  // Aviso si parece un tercero mal escrito (por eso quedó como CENTRAL GANADERA)
  if (!result.tercero && inputCk) {
    const near = TERCEROS.find((t) => dice(inputCk, compactKey(t)) >= 0.75);
    if (near) {
      result.terceroParecido = near;
      result.valFacturarMsg += ` Ojo: «${result.input.facturador}» se parece a «${near}»; si es el mismo, corrija el nombre o apruebe la equivalencia.`;
    }
  }

  // Datos de REMIX visibles
  const shownRows = matched ? rows.filter((r) => r.f === matched) : rows;
  result.facturarRemix = uniq(shownRows.map((r) => r.f).filter(Boolean)).map((f) => displayName(index, 'facturador', f)).join(' / ');
  result.facturarRemixBasis = result.facturarRemix ? basis : '';
  const xVals = new Map();
  for (const r of shownRows) if (r.x) { const ck = compactKey(r.x); if (!xVals.has(ck)) xVals.set(ck, r.x); }
  result.facturadorRemix = index.hasFacturadorRemix ? [...xVals.values()].join(' / ') : '';
  result.facturadorRemixKeys = [...xVals.keys()];
  result.facturadorRemixBasis = result.facturadorRemix ? basis : '';
}

// ---------------------------------------------------------------------------
// Confirmación manual («chulito»): identidad del registro y de su novedad.
// ---------------------------------------------------------------------------
/** Identifica el mismo registro entre cargas: Lote + NIT + los tres nombres (normalizados). */
export function recordKey({ lote = '', nit = '', cliente = '', facturador = '', proveedor = '' }) {
  return [lote, nit, cliente, facturador, proveedor].map((v) => compactKey(v)).join('|');
}

/** Huella de la novedad: si cambia, una confirmación anterior ya no aplica. */
export function issueSignature(result) {
  const base = result.baseStatus || result.status;
  const parts = FIELDS.map(({ key }) => {
    const f = result.fields[key];
    const target = f.status === 'revisar' ? f.candidates?.[0]?.compact || '' : f.status === 'no_encontrado' ? '' : (f.matches || []).join(',');
    return `${key}:${f.status}:${f.label || ''}:${target}`;
  });
  return [base, ...parts, `vf:${result.valFacturar || ''}`].join('|');
}

/** Estados que admiten confirmación manual. */
export const CONFIRMABLE = new Set([STATUS.NUEVO_PROVEEDOR, STATUS.VALIDAR_CLIENTE, STATUS.REVISAR, STATUS.NO_ENCONTRADO, STATUS.RELACION]);

function validateAgainstRemix(index, eq, input, { ignoreFacturador = false } = {}) {
  const res = {};
  for (const { key } of FIELDS) {
    res[key] = key === 'facturador' && ignoreFacturador
      ? { status: 'no_aplica', input: input[key] ?? '', candidates: [], label: 'NO APLICA', reason: 'Tercero: no se compara con Facturar a Nombre de.' }
      : resolveField(index, eq, key, input[key]);
  }

  const certain = (r) => r.status === 'exacto' || r.status === 'equivalencia';
  const result = { input: { ...input }, fields: res, status: null, warnings: [], notes: [], registered: [] };

  // Advertencias por campo
  for (const { key, label } of FIELDS) {
    const r = res[key];
    if (r.status === 'vacio') {
      result.warnings.push({ field: key, campo: label, nombreRemix: '', mensaje: 'NO ENCONTRADO: campo vacío.' });
    } else if (r.status === 'revisar') {
      const top = r.candidates[0];
      r.label = KIND_LABEL[top.kind];
      r.reason = reasonText(top.kind, top.display);
      if (r.totalCandidates > 1) r.reason += ` (${r.totalCandidates} posibles coincidencias en REMIX)`;
      result.warnings.push({ field: key, campo: label, nombreRemix: top.display, mensaje: `${r.label}: ${r.reason}` });
    } else if (r.status === 'no_encontrado') {
      r.label = 'NO ENCONTRADO';
      r.reason = r.closest
        ? `No existe en la columna «${REMIX_COLUMN[key]}» de REMIX. Sugerencia más cercana (baja confianza): «${r.closest.display}».`
        : `No existe en la columna «${REMIX_COLUMN[key]}» de REMIX y no hay un nombre razonablemente parecido.`;
      if (r.rejectedHits) r.reason += ' Hay equivalencias descartadas previamente para este nombre.';
      result.warnings.push({ field: key, campo: label, nombreRemix: r.closest?.display || '', mensaje: `NO ENCONTRADO: ${r.reason}` });
    } else if (r.status === 'equivalencia') {
      r.label = 'EQUIVALENCIA APROBADA';
      r.reason = `Equivale a «${displayName(index, key, r.matches[0])}» en REMIX.`;
    }
  }

  const C = res.cliente, F = res.facturador, P = res.proveedor;

  if (ignoreFacturador) return validateClienteProveedor(index, result, C, P);

  if ([C, F, P].every(certain)) {
    const combo = anyCombo(index, C.matches, F.matches, P.matches);
    if (combo) {
      result.status = STATUS.CORRECTO;
      result.viaEquivalence = [C, F, P].some((r) => r.status === 'equivalencia');
      result.remix = {
        cliente: displayName(index, 'cliente', combo.c),
        facturador: displayName(index, 'facturador', combo.f),
        proveedor: displayName(index, 'proveedor', combo.p),
      };
      result.remixKeys = combo;
    } else if (classifyNew(index, result, C.matches, F.matches, P.matches)) {
      // NUEVO PROVEEDOR o VALIDAR CLIENTE
    } else {
      result.status = STATUS.RELACION;
      const exp = relationExplanation(index, C.matches, F.matches, P.matches);
      result.notes.push(exp.text);
      result.registered = exp.registered;
      result.warnings.push({
        field: 'relacion',
        campo: 'Relación Cliente → Facturar a nombre de → Proveedor',
        nombreRemix: exp.registered.length ? `Registradas para el cliente: ${exp.registered.slice(0, 5).join('; ')}` : '',
        mensaje: `ADVERTENCIA: RELACIÓN NO REGISTRADA EN REMIX. ${exp.text}`,
      });
    }
    return result;
  }

  // Proveedor que no existe en REMIX para un Cliente + Facturador ya relacionados → NUEVO PROVEEDOR.
  // Cliente que no existe en REMIX con un Facturador + Proveedor ya relacionados → VALIDAR CLIENTE.
  if (certain(C) && certain(F) && P.status === 'no_encontrado' && anyPair(index.pairs.cf, C.matches, F.matches)) {
    result.warnings = result.warnings.filter((w) => w.field !== 'proveedor');
    setNewProvider(index, result, C.matches, F.matches, true);
    return result;
  }
  if (certain(F) && certain(P) && C.status === 'no_encontrado' && anyPair(index.pairs.fp, F.matches, P.matches)) {
    result.warnings = result.warnings.filter((w) => w.field !== 'cliente');
    setValidateClient(index, result, F.matches, P.matches, true);
    return result;
  }

  // Hay campos dudosos o no encontrados.
  const hasMissing = [C, F, P].some((r) => r.status === 'no_encontrado' || r.status === 'vacio');
  result.status = hasMissing ? STATUS.NO_ENCONTRADO : STATUS.REVISAR;

  // ¿Alguna combinación de candidatos formaría una relación registrada?
  const options = (r) => (certain(r) ? r.matches : r.status === 'revisar' ? r.candidates.map((c) => c.compact) : []);
  const [oc, of, op] = [options(C), options(F), options(P)];
  if (oc.length && of.length && op.length) {
    const combo = anyCombo(index, oc, of, op);
    if (combo) {
      // Prioriza el candidato que completa la relación
      for (const [r, k] of [[C, combo.c], [F, combo.f], [P, combo.p]]) {
        if (r.status === 'revisar') {
          const i = r.candidates.findIndex((c) => c.compact === k);
          if (i > 0) r.candidates.unshift(r.candidates.splice(i, 1)[0]);
          r.candidates[0].completesRelation = true;
        }
      }
      result.remix = {
        cliente: displayName(index, 'cliente', combo.c),
        facturador: displayName(index, 'facturador', combo.f),
        proveedor: displayName(index, 'proveedor', combo.p),
      };
      result.remixKeys = combo;
      result.notes.push(`Si se confirman los nombres sugeridos, la relación «${result.remix.cliente} → ${result.remix.facturador} → ${result.remix.proveedor}» sí existe en REMIX.`);
      // Actualiza la sugerencia de la advertencia con el candidato priorizado
      for (const w of result.warnings) {
        const r = res[w.field];
        if (r?.status === 'revisar') {
          const top = r.candidates[0];
          r.label = KIND_LABEL[top.kind];
          r.reason = reasonText(top.kind, top.display) + (r.totalCandidates > 1 ? ` (${r.totalCandidates} posibles coincidencias en REMIX)` : '');
          w.nombreRemix = top.display;
          w.mensaje = `${r.label}: ${r.reason}`;
        }
      }
    } else {
      result.notes.push('Aun aceptando los nombres sugeridos, la relación no aparece en REMIX.');
    }
  }
  return result;
}

function setNewProvider(index, result, C, F, notInRemix) {
  const known = providersFor(index, C, F);
  const p = result.fields.proveedor;
  result.status = STATUS.NUEVO_PROVEEDOR;
  result.newProviderKnown = known;
  const extra = notInRemix
    ? ' El proveedor no existe todavía en REMIX.' + (p.closest ? ` Verifique que no sea «${p.closest.display}» mal escrito.` : '')
    : ' El proveedor sí existe en REMIX, pero con otro cliente o facturar a nombre de.';
  const text = `El Cliente y el Facturar a nombre de están relacionados en REMIX; este proveedor es nuevo para ellos.${extra}`;
  p.label = 'NUEVO PROVEEDOR';
  p.reason = text;
  result.notes.push(text);
  result.registered = known.map((x) => `Proveedor registrado: ${x}`);
  result.warnings.push({
    field: 'proveedor', campo: 'Proveedor',
    nombreRemix: known.length ? `Proveedores registrados para este cliente y facturar a nombre de: ${known.slice(0, 8).join('; ')}` : '',
    mensaje: `NUEVO PROVEEDOR: ${text}`,
  });
}

function setValidateClient(index, result, F, P, notInRemix) {
  const known = clientsFor(index, F, P);
  const c = result.fields.cliente;
  result.status = STATUS.VALIDAR_CLIENTE;
  const extra = notInRemix ? ' El cliente no existe todavía en REMIX.' + (c.closest ? ` Verifique que no sea «${c.closest.display}» mal escrito.` : '') : '';
  const text = `El Facturar a nombre de y el Proveedor están relacionados en REMIX, pero no con este Cliente. Posible cliente nuevo: valide que el Facturar a nombre de le corresponda.${extra}`;
  c.label = 'VALIDAR CLIENTE';
  c.reason = text;
  result.notes.push(text);
  result.registered = known.map((x) => `Cliente registrado con este facturador y proveedor: ${x}`);
  result.warnings.push({
    field: 'cliente', campo: 'Cliente de planta',
    nombreRemix: known.length ? `Clientes registrados con este facturar a nombre de y proveedor: ${known.slice(0, 8).join('; ')}` : '',
    mensaje: `VALIDAR CLIENTE: ${text}`,
  });
}

// Con los tres nombres en REMIX pero sin la fila completa.
function classifyNew(index, result, C, F, P) {
  const cf = anyPair(index.pairs.cf, C, F);
  const cp = anyPair(index.pairs.cp, C, P);
  const fp = anyPair(index.pairs.fp, F, P);
  if (cf && !cp) { setNewProvider(index, result, C, F, false); return true; }
  if (fp && !cf && !cp) { setValidateClient(index, result, F, P, false); return true; }
  return false;
}

// ---------------------------------------------------------------------------
// Terceros (AGROFAR / SANDRA): relación por Cliente + Proveedor, sin mirar Facturar a nombre de.
// ---------------------------------------------------------------------------
function firstPair(set, A, B) {
  for (const a of A) for (const b of B) if (set.has(pairKey(a, b))) return { c: a, p: b };
  return null;
}

function validateClienteProveedor(index, result, C, P) {
  const certain = (r) => r.status === 'exacto' || r.status === 'equivalencia';
  if (certain(C) && certain(P)) {
    const pair = firstPair(index.pairs.cp, C.matches, P.matches);
    if (pair) {
      result.status = STATUS.CORRECTO;
      result.viaEquivalence = [C, P].some((r) => r.status === 'equivalencia');
      result.remix = { cliente: displayName(index, 'cliente', pair.c), facturador: '', proveedor: displayName(index, 'proveedor', pair.p) };
      result.remixCP = pair;
    } else {
      setNewProviderCP(index, result, C.matches, false);
    }
    return result;
  }
  if (certain(C) && P.status === 'no_encontrado') {
    result.warnings = result.warnings.filter((w) => w.field !== 'proveedor');
    setNewProviderCP(index, result, C.matches, true);
    return result;
  }
  if (certain(P) && C.status === 'no_encontrado') {
    result.warnings = result.warnings.filter((w) => w.field !== 'cliente');
    setValidateClientCP(index, result, P.matches);
    return result;
  }
  const hasMissing = [C, P].some((r) => r.status === 'no_encontrado' || r.status === 'vacio');
  result.status = hasMissing ? STATUS.NO_ENCONTRADO : STATUS.REVISAR;
  const options = (r) => (certain(r) ? r.matches : r.status === 'revisar' ? r.candidates.map((c) => c.compact) : []);
  const [oc, op] = [options(C), options(P)];
  if (oc.length && op.length) {
    const pair = firstPair(index.pairs.cp, oc, op);
    if (pair) {
      for (const [r, k] of [[C, pair.c], [P, pair.p]]) {
        if (r.status === 'revisar') {
          const i = r.candidates.findIndex((c) => c.compact === k);
          if (i > 0) r.candidates.unshift(r.candidates.splice(i, 1)[0]);
          r.candidates[0].completesRelation = true;
        }
      }
      result.remix = { cliente: displayName(index, 'cliente', pair.c), facturador: '', proveedor: displayName(index, 'proveedor', pair.p) };
      result.remixCP = pair;
      result.notes.push(`Si se confirman los nombres sugeridos, la relación «${result.remix.cliente} → ${result.remix.proveedor}» sí existe en REMIX.`);
      for (const w of result.warnings) {
        const r = result.fields[w.field];
        if (r?.status === 'revisar') {
          const top = r.candidates[0];
          r.label = KIND_LABEL[top.kind];
          r.reason = reasonText(top.kind, top.display) + (r.totalCandidates > 1 ? ` (${r.totalCandidates} posibles coincidencias en REMIX)` : '');
          w.nombreRemix = top.display;
          w.mensaje = `${r.label}: ${r.reason}`;
        }
      }
    } else {
      result.notes.push('Aun aceptando los nombres sugeridos, la relación Cliente → Proveedor no aparece en REMIX.');
    }
  }
  return result;
}

function setNewProviderCP(index, result, C, notInRemix) {
  const known = [];
  for (const c of C) for (const { p } of index.byCliente.get(c) || []) known.push(displayName(index, 'proveedor', p));
  const k = uniq(known);
  const p = result.fields.proveedor;
  result.status = STATUS.NUEVO_PROVEEDOR;
  result.newProviderKnown = k;
  const extra = notInRemix
    ? ' El proveedor no existe todavía en REMIX.' + (p.closest ? ` Verifique que no sea «${p.closest.display}» mal escrito.` : '')
    : ' El proveedor sí existe en REMIX, pero con otro cliente.';
  const text = `El Cliente está en REMIX; este proveedor es nuevo para él.${extra}`;
  p.label = 'NUEVO PROVEEDOR';
  p.reason = text;
  result.notes.push(text);
  result.registered = k.map((x) => `Proveedor registrado: ${x}`);
  result.warnings.push({
    field: 'proveedor', campo: 'Proveedor',
    nombreRemix: k.length ? `Proveedores registrados para este cliente: ${k.slice(0, 8).join('; ')}` : '',
    mensaje: `NUEVO PROVEEDOR: ${text}`,
  });
}

function setValidateClientCP(index, result, P) {
  const known = [];
  for (const p of P) for (const c of index.clientsByProv.get(p) || []) known.push(displayName(index, 'cliente', c));
  const k = uniq(known);
  const c = result.fields.cliente;
  result.status = STATUS.VALIDAR_CLIENTE;
  const text = `El Proveedor está en REMIX, pero no con este Cliente. Posible cliente nuevo.${c.closest ? ` Verifique que no sea «${c.closest.display}» mal escrito.` : ''}`;
  c.label = 'VALIDAR CLIENTE';
  c.reason = text;
  result.notes.push(text);
  result.registered = k.map((x) => `Cliente registrado con este proveedor: ${x}`);
  result.warnings.push({
    field: 'cliente', campo: 'Cliente de planta',
    nombreRemix: k.length ? `Clientes registrados con este proveedor: ${k.slice(0, 8).join('; ')}` : '',
    mensaje: `VALIDAR CLIENTE: ${text}`,
  });
}

export function isWarning(result) {
  return result.status !== STATUS.CORRECTO;
}

// ---------------------------------------------------------------------------
// Lectura de hojas (matriz de celdas → registros). Sin dependencias.
// ---------------------------------------------------------------------------
// Encabezados exactos por tipo de archivo (se ignoran mayúsculas, tildes y espacios).
// En REMIX el facturador se toma de «Facturar a Nombre de»; su columna «Facturador» se ignora.
export const SOURCE_HEADERS = {
  // Nombres del informe diario. El primero de cada lista tiene prioridad; los anteriores siguen sirviendo.
  informe: {
    cliente: { label: 'Cliente planta', keys: ['CLIENTEPLANTA', 'CLIENTEDEPLANTA'] },
    facturador: { label: 'Cliente factura', keys: ['CLIENTEFACTURA', 'FACTURADOR'] },
    proveedor: { label: 'Proveedor', keys: ['PROVEEDOR'] },
  },
  remix: {
    cliente: { label: 'Cliente de planta', keys: ['CLIENTEDEPLANTA'] },
    facturador: { label: 'Facturar a Nombre de', keys: ['FACTURARANOMBREDE'] },
    proveedor: { label: 'Proveedor', keys: ['PROVEEDOR'] },
    // Solo informativa: se muestra como «FACTURADOR (REMIX)». Nunca se usa para validar.
    facturadorRemix: { label: 'Facturador', keys: ['FACTURADOR'], optional: true },
  },
};

/** Nombre de la columna en REMIX para cada campo (para los mensajes). */
export const REMIX_COLUMN = Object.fromEntries(Object.entries(SOURCE_HEADERS.remix).filter(([, v]) => !v.optional).map(([k, v]) => [k, v.label]));

/**
 * matrix: array de filas (array de celdas), p. ej. XLSX.utils.sheet_to_json(ws, {header:1}).
 * Busca la fila de encabezados en las primeras 15 filas. Mapea por NOMBRE, nunca por posición.
 */
export function rowsFromMatrix(matrix, kind = 'informe') {
  const spec = SOURCE_HEADERS[kind];
  const HEADER_KEYS = Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, v.keys]));
  const required = Object.keys(spec).filter((k) => !spec[k].optional);
  const errors = [];
  let headerRow = -1;
  let map = null;
  for (let r = 0; r < Math.min(matrix.length, 15); r++) {
    const row = matrix[r] || [];
    const found = {};
    const rank = {};
    const dup = [];
    row.forEach((cell, ci) => {
      const h = normalizeHeader(cell);
      for (const [key, aliases] of Object.entries(HEADER_KEYS)) {
        const k = aliases.indexOf(h);
        if (k < 0) continue;
        if (found[key] === undefined || k < rank[key]) { found[key] = ci; rank[key] = k; }
        else if (k === rank[key]) dup.push(key); // mismo nombre repetido: no se adivina
      }
    });
    // Un nombre de menor prioridad repetido no importa si el principal está presente.
    for (let i = dup.length - 1; i >= 0; i--) {
      const key = dup[i];
      const same = row.filter((cell) => normalizeHeader(cell) === HEADER_KEYS[key][rank[key]]).length;
      if (same < 2) dup.splice(i, 1);
    }
    if (required.every((k) => found[k] !== undefined)) {
      if (dup.length) {
        errors.push(`La columna ${dup.map((d) => spec[d].label).join(', ')} aparece repetida en los encabezados.`);
        return { rows: [], errors, headerRow: r };
      }
      headerRow = r; map = found;
      // Columna informativa opcional con nombre parecido («FACTURADOR REMIX», «NOMBRE FACTURADOR»…).
      for (const [key, v] of Object.entries(spec)) {
        if (!v.optional || map[key] !== undefined) continue;
        const used = new Set(Object.values(map));
        const ci = row.findIndex((cell, i) => !used.has(i) && v.keys.some((k) => normalizeHeader(cell).includes(k))
          && !Object.entries(spec).some(([k2, v2]) => k2 !== key && v2.keys.includes(normalizeHeader(cell))));
        if (ci >= 0) map[key] = ci;
      }
      break;
    }
  }
  if (!map) {
    const names = Object.values(spec).filter((v) => !v.optional).map((v) => `«${v.label}»`);
    errors.push(`No se encontraron los encabezados ${names.slice(0, -1).join(', ')} y ${names.at(-1)} en las primeras 15 filas${kind === 'remix' ? ' del archivo REMIX' : ''}.`);
    return { rows: [], errors, headerRow: -1 };
  }
  // Columnas adicionales: se conservan y se muestran, pero no se validan.
  const keyCols = new Set(Object.values(map));
  const headerCells = matrix[headerRow] || [];
  const width = Math.max(headerCells.length, ...matrix.slice(headerRow + 1).map((r) => (r || []).length));
  const extraCols = [];
  const usedNames = new Set();
  for (let ci = 0; ci < width; ci++) {
    if (keyCols.has(ci)) continue;
    let name = String(headerCells[ci] ?? '').trim().replace(/\s+/g, ' ');
    const hasData = matrix.slice(headerRow + 1).some((r) => String((r || [])[ci] ?? '').trim() !== '');
    if (!name && !hasData) continue;
    if (!name) name = `Columna ${ci + 1}`;
    let unique = name, k = 2;
    while (usedNames.has(unique)) unique = `${name} (${k++})`;
    usedNames.add(unique);
    extraCols.push({ index: ci, name: unique });
  }

  const rows = [];
  let skipped = 0;
  for (let r = headerRow + 1; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const rec = {
      cliente: String(row[map.cliente] ?? '').trim(),
      facturador: String(row[map.facturador] ?? '').trim(),
      proveedor: String(row[map.proveedor] ?? '').trim(),
      sourceRow: r + 1,
      extra: extraCols.map((c) => String(row[c.index] ?? '').trim()),
    };
    if (map.facturadorRemix !== undefined) rec.facturadorRemix = String(row[map.facturadorRemix] ?? '').trim();
    if (!rec.cliente && !rec.facturador && !rec.proveedor) { skipped++; continue; }
    rows.push(rec);
  }
  const headerNames = Object.fromEntries(Object.entries(map).map(([k, ci]) => [k, String(headerCells[ci] ?? '').trim()]));
  return { rows, errors, headerRow, columns: map, headerNames, allHeaders: headerCells.map((x) => String(x ?? '').trim()).filter(Boolean), skipped, extraHeaders: extraCols.map((c) => c.name) };
}
