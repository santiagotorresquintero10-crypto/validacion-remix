// ============================================================================
// Capa de datos: Firebase Authentication + Cloud Firestore
// ============================================================================
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, collection, query, orderBy, limit, where,
  writeBatch, serverTimestamp, addDoc, arrayUnion,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { equivalenceId, compactKey } from './engine.js';

export const isConfigured = !String(firebaseConfig.apiKey).includes('PEGAR_AQUI');

const app = isConfigured ? initializeApp(firebaseConfig) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;

const CHUNK_SIZE = 2000; // margen bajo el límite de 1 MB por documento
const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Autenticación y perfil
// ---------------------------------------------------------------------------
export const onAuth = (cb) => onAuthStateChanged(auth, cb);
export const login = (email, password) => signInWithEmailAndPassword(auth, email.trim(), password);
export const logout = () => signOut(auth);
export const resetPassword = (email) => sendPasswordResetEmail(auth, email.trim());

// ---------------------------------------------------------------------------
// REMIX (versionado, en bloques)
// ---------------------------------------------------------------------------
export async function getRemixMeta() {
  const snap = await getDoc(doc(db, 'config', 'remix'));
  return snap.exists() ? snap.data() : null;
}

export async function loadRemixVersion(versionId) {
  const cacheKey = `remix-cache-${versionId}`;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch { /* caché no disponible */ }

  const vSnap = await getDoc(doc(db, 'remixVersions', versionId));
  if (!vSnap.exists()) throw new Error(`No existe la versión de REMIX ${versionId}.`);
  const meta = vSnap.data();
  const chunks = await getDocs(collection(db, 'remixVersions', versionId, 'chunks'));
  const ordered = chunks.docs.map((d) => d.data()).sort((a, b) => a.n - b.n);
  if (ordered.length !== meta.chunkCount) throw new Error('La versión de REMIX está incompleta. Contacte al administrador.');
  const rows = ordered.flatMap((c) => c.rows.map((r) => ({ cliente: r.c, facturador: r.f, proveedor: r.p, facturadorRemix: r.x || '' })));
  if (rows.length !== meta.rowCount) throw new Error('El número de filas de REMIX no coincide con lo registrado.');

  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('remix-cache-')) localStorage.removeItem(k);
    localStorage.setItem(cacheKey, JSON.stringify(rows));
  } catch { /* sin espacio: se omite la caché */ }
  return rows;
}

export async function listRemixVersions() {
  const snap = await getDocs(query(collection(db, 'remixVersions'), orderBy('createdAt', 'desc'), limit(20)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Escribe una versión nueva. Solo la activa si todos los bloques se guardaron. */
export async function saveRemixVersion(rows, fileName) {
  const versionId = `v${Date.now()}`;
  const chunkCount = Math.ceil(rows.length / CHUNK_SIZE);
  const vRef = doc(db, 'remixVersions', versionId);
  await setDoc(vRef, {
    createdAt: serverTimestamp(), createdBy: auth.currentUser.uid, createdByEmail: auth.currentUser.email,
    fileName, rowCount: rows.length, chunkCount, status: 'escribiendo',
  });
  for (let start = 0; start < chunkCount; start += 400) {
    const batch = writeBatch(db);
    for (let n = start; n < Math.min(chunkCount, start + 400); n++) {
      const slice = rows.slice(n * CHUNK_SIZE, (n + 1) * CHUNK_SIZE)
        .map((r) => (r.facturadorRemix ? { c: r.cliente, f: r.facturador, p: r.proveedor, x: r.facturadorRemix } : { c: r.cliente, f: r.facturador, p: r.proveedor }));
      batch.set(doc(db, 'remixVersions', versionId, 'chunks', String(n).padStart(4, '0')), { n, rows: slice });
    }
    await batch.commit();
  }
  await updateDoc(vRef, { status: 'completa' });
  return versionId;
}

export async function activateRemixVersion(versionId, previousVersion, info) {
  await setDoc(doc(db, 'config', 'remix'), {
    activeVersion: versionId,
    previousVersion: previousVersion || null,
    rowCount: info.rowCount,
    fileName: info.fileName,
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser.uid,
    updatedByEmail: auth.currentUser.email,
  });
}

// ---------------------------------------------------------------------------
// Equivalencias
// ---------------------------------------------------------------------------
export async function loadEquivalences() {
  const snap = await getDocs(collection(db, 'equivalences'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * decision: 'misma' | 'diferente' → queda aprobada / rechazada para todos los usuarios.
 */
export async function decideEquivalence({ field, input, remixName, decision, existing }) {
  const id = equivalenceId(field, input, remixName);
  const ref = doc(db, 'equivalences', id);
  const user = auth.currentUser;
  const status = decision === 'misma' ? 'aprobada' : 'rechazada';
  const entry = { at: nowIso(), by: user.email, action: status };
  const base = {
    field, a: String(input).trim(), b: String(remixName).trim(),
    aKey: compactKey(input), bKey: compactKey(remixName),
    status, proposal: decision,
    decidedBy: user.uid, decidedByEmail: user.email, decidedAt: serverTimestamp(),
  };

  if (existing) await updateDoc(ref, { ...base, history: arrayUnion(entry) });
  else await setDoc(ref, { ...base, history: [entry] });
  return { id, ...base };
}

/** Aprobar, descartar o revertir una equivalencia existente (o semilla). */
export async function setEquivalenceStatus(eqDoc, status) {
  const ref = doc(db, 'equivalences', eqDoc.id);
  const user = auth.currentUser;
  const entry = { at: nowIso(), by: user.email, action: status };
  const data = {
    field: eqDoc.field, a: eqDoc.a, b: eqDoc.b, aKey: compactKey(eqDoc.a), bKey: compactKey(eqDoc.b),
    status, decidedBy: user.uid, decidedByEmail: user.email, decidedAt: serverTimestamp(),
  };
  if (eqDoc.seed && !eqDoc.history) await setDoc(ref, { ...data, proposal: 'misma', history: [{ at: nowIso(), by: 'especificación', action: 'aprobada' }, entry] });
  else await updateDoc(ref, { ...data, history: arrayUnion(entry) });
}

export async function markEquivalencesStale(results, versionId) {
  const batch = writeBatch(db);
  for (const r of results) {
    if (r.seed && !r.persisted) continue;
    batch.update(doc(db, 'equivalences', r.id), { staleInVersion: r.stale ? versionId : null });
  }
  await batch.commit();
}

// ---------------------------------------------------------------------------
// Historial
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Confirmaciones manuales («chulito»)
// ---------------------------------------------------------------------------
// Id estable a partir de la clave del registro (la clave completa se guarda y se verifica al usar).
function hashId(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `c${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}

export async function loadConfirmations() {
  const snap = await getDocs(query(collection(db, 'confirmaciones'), where('active', '==', true)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Marca (active=true) o desmarca (active=false) un registro como gestionado.
 * Nunca se borra: queda historial de quién y cuándo.
 */
export async function setConfirmation({ key, sig, active, record, originalStatus, fileName, remixVersion }) {
  const user = auth.currentUser;
  const id = hashId(key);
  const entry = { at: nowIso(), by: user.email, action: active ? 'confirmado' : 'desmarcado', status: originalStatus };
  const data = {
    key, sig, active, originalStatus,
    lote: record.lote || '', nit: record.nit || '',
    cliente: record.cliente || '', facturador: record.facturador || '', proveedor: record.proveedor || '',
    fileName: fileName || null, remixVersion: remixVersion || null,
    by: user.uid, byEmail: user.email, at: serverTimestamp(),
    history: arrayUnion(entry),
  };
  await setDoc(doc(db, 'confirmaciones', id), data, { merge: true });
  return { id, ...data, at: new Date(), history: undefined };
}

export async function saveHistory({ source, fileName, remixVersion, results }) {
  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  const compact = results.slice(0, 300).map((r) => ({
    c: r.input.cliente || '', f: r.input.facturador || '', p: r.input.proveedor || '', s: r.status,
  }));
  await addDoc(collection(db, 'validaciones'), {
    uid: auth.currentUser.uid, email: auth.currentUser.email, at: serverTimestamp(),
    source, fileName: fileName || null, remixVersion, total: results.length, counts, rows: compact,
  });
}
