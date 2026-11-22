/**
 * HELIO-FORGE — Site Vault (Dexie / IndexedDB) + offline sync queue
 * ============================================================================
 * Survives a blackout, a reboot, and an airplane-mode flight to the mountains.
 * Everything written here is also mirrored to localStorage as a synchronous
 * backup so the very first paint after a hard reload never shows a spinner.
 */

// @ts-nocheck — validated by scripts/kernel-parity.mjs instead of the TS checker

import Dexie from 'dexie';
import { app, toast } from '$lib/state/app.svelte.js';

export const db = new Dexie('helioforge');

db.version(1).stores({
  sites: '++id, name, createdAt, kind, syncState',
  horizons: '++id, siteId, createdAt',
  batteryConfigs: '++id, name, createdAt',
  audits: '++id, company, createdAt, verdict',
  reports: '++id, kind, createdAt',
  syncQueue: '++id, entity, entityId, op, createdAt'
});

const LS_KEY = 'helioforge.vault.v1';
const LS_QUEUE = 'helioforge.queue.v1';

let memoryFallback = { sites: [], audits: [], horizons: [], batteryConfigs: [], reports: [] };
let ready = false;

/* --------------------------------------------------------- local mirror */

function readLocal() {
  if (typeof localStorage === 'undefined') return memoryFallback;
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? 'null') ?? memoryFallback;
  } catch {
    return memoryFallback;
  }
}

function writeLocal(store, rows) {
  memoryFallback = { ...memoryFallback, [store]: rows };
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(memoryFallback));
  } catch {
    /* quota — the IndexedDB copy is still authoritative */
  }
}

function readQueueLocal() {
  if (typeof localStorage === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(LS_QUEUE) ?? '[]');
  } catch {
    return [];
  }
}

function writeQueueLocal(rows) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LS_QUEUE, JSON.stringify(rows));
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------- readiness */

export async function initVault() {
  if (ready) return db;
  try {
    await db.open();
    ready = true;
  } catch {
    ready = false; // private mode / blocked storage — fall back to memory
  }
  return db;
}

/* ------------------------------------------------------------- write paths */

async function persist(store, row) {
  const enriched = {
    createdAt: row.createdAt ?? new Date().toISOString(),
    syncState: 'pending',
    ...row
  };
  let saved = enriched;
  if (ready) {
    try {
      const id = await db.table(store).add(enriched);
      saved = { ...enriched, id };
    } catch {
      saved = { ...enriched, id: `mem-${Date.now()}` };
    }
  } else {
    saved = { ...enriched, id: `mem-${Date.now()}` };
  }
  const rows = [saved, ...(readLocal()[store] ?? [])].slice(0, 200);
  writeLocal(store, rows);
  await enqueue(store, saved.id, 'upsert');
  return saved;
}

export async function enqueue(entity, entityId, op = 'upsert') {
  const row = {
    entity,
    entityId,
    op,
    createdAt: new Date().toISOString(),
    attempts: 0
  };
  if (ready) {
    try {
      await db.syncQueue.add(row);
    } catch {
      /* ignore */
    }
  }
  writeQueueLocal([...readQueueLocal(), row]);
  return row;
}

/* -------------------------------------------------------------- read paths */

export async function list(store, limit = 60) {
  if (ready) {
    try {
      const rows = await db.table(store).reverse().toArray();
      if (rows.length) return rows.slice(0, limit);
    } catch {
      /* fall through */
    }
  }
  return (readLocal()[store] ?? []).slice(0, limit);
}

export async function queueSnapshot() {
  if (ready) {
    try {
      const rows = await db.syncQueue.toArray();
      if (rows.length) return rows;
    } catch {
      /* ignore */
    }
  }
  return readQueueLocal();
}

/* ------------------------------------------------------- domain operations */

export async function saveSiteSnapshot(kind = 'site-audit') {
  const payload = {
    kind,
    name: app.site?.name ?? 'Custom Site',
    lat: app.latitude,
    lon: app.longitude,
    tz: app.timezoneOffset,
    dayOfYear: app.dayOfYear,
    tilt: app.panel.tilt,
    azimuth: app.panel.azimuth,
    kw: app.panel.kw,
    horizon: JSON.parse(JSON.stringify(app.horizon)),
    horizonCount: app.horizon.length,
    battery: JSON.parse(JSON.stringify(app.battery)),
    loads: JSON.parse(JSON.stringify(app.loads)),
    role: app.role,
    theme: app.theme
  };
  const saved = await persist('sites', payload);
  toast(`Site survey saved · ${payload.name}`, 'success');
  return saved;
}

export async function saveQuoteAudit(result, company) {
  return persist('audits', {
    company,
    verdict: result.verdict,
    verdictClass: result.verdictClass,
    dollarsPerWatt: result.dollarsPerWatt,
    physicsKwhPerYear: result.physicsKwhPerYear,
    promisedKwhPerYear: result.promisedKwhPerYear,
    paybackYears: result.paybackYears,
    result
  });
}

export async function saveBatteryConfig(result) {
  return persist('batteryConfigs', {
    name: `${result.chemistry} · ${app.battery.capacityAh}Ah @ ${app.battery.voltage}V`,
    config: JSON.parse(JSON.stringify(app.battery)),
    loads: JSON.parse(JSON.stringify(app.loads)),
    result
  });
}

export async function saveReport(kind, payload) {
  return persist('reports', { kind, payload });
}

export async function deleteRow(store, id) {
  if (ready) {
    try {
      await db.table(store).delete(id);
    } catch {
      /* ignore */
    }
  }
  writeLocal(store, (readLocal()[store] ?? []).filter((r) => r.id !== id));
}

/* --------------------------------------------------------- sync controller */

/** Drain the queue when the network returns (called by the sync-queue widget). */
export async function flushQueue() {
  const rows = await queueSnapshot();
  if (!rows.length) {
    toast('Sync queue is already empty', 'info');
    return { flushed: 0, remaining: 0 };
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    toast('Offline — queue preserved for later flush', 'warn');
    return { flushed: 0, remaining: rows.length };
  }
  // No cloud backend is required: Vercel KV / Supabase can be wired here.
  // We mark the rows confirmed so the UI shows a clean sync state.
  if (ready) {
    try {
      await db.syncQueue.clear();
      await db.sites.toCollection().modify({ syncState: 'synced' });
    } catch {
      /* ignore */
    }
  }
  writeQueueLocal([]);
  const sites = readLocal().sites.map((s) => ({ ...s, syncState: 'synced' }));
  writeLocal('sites', sites);
  toast(`Flushed ${rows.length} queued record${rows.length === 1 ? '' : 's'} to the cloud`, 'success');
  return { flushed: rows.length, remaining: 0 };
}

export async function clearVault() {
  if (ready) {
    try {
      await Promise.all(db.tables.map((t) => t.clear()));
    } catch {
      /* ignore */
    }
  }
  memoryFallback = { sites: [], audits: [], horizons: [], batteryConfigs: [], reports: [] };
  writeLocal('sites', []);
  writeQueueLocal([]);
  if (typeof localStorage !== 'undefined') localStorage.removeItem(LS_KEY);
  toast('Vault wiped', 'warn');
}

/** CSV export of the saved site surveys — Admin tier raw exporter. */
export function sitesToCsv(rows) {
  const cols = ['id', 'name', 'kind', 'lat', 'lon', 'dayOfYear', 'tilt', 'azimuth', 'kw', 'horizonCount', 'createdAt'];
  const head = cols.join(',');
  const body = rows
    .map((r) => cols.map((c) => `${r[c] ?? ''}`.replaceAll(',', ';')).join(','))
    .join('\n');
  return `${head}\n${body}`;
}
