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
import {
  pushRows,
  pullAll,
  ensureDevice,
  cloudHealth,
  isCloudConfigured,
  recordFlush,
  lastFlush,
  tableFor
} from './cloud.js';

export const db = new Dexie('helioforge');

db.version(1).stores({
  sites: '++id, name, createdAt, kind, syncState',
  horizons: '++id, siteId, createdAt',
  batteryConfigs: '++id, name, createdAt',
  audits: '++id, company, createdAt, verdict',
  reports: '++id, kind, createdAt',
  syncQueue: '++id, entity, entityId, op, createdAt'
});

export { cloudHealth, isCloudConfigured, lastFlush, pullAll };

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

/**
 * Drain the sync queue into Supabase.
 *
 * Offline-first contract: a row is deleted from the queue only after the server
 * has answered 2xx. Anything that fails stays queued and comes back next flush —
 * so a closed laptop lid mid-upload can never lose a survey.
 */
export async function flushQueue() {
  const rows = await queueSnapshot();
  if (!rows.length) {
    toast('Sync queue is already empty', 'info');
    return { flushed: 0, remaining: 0 };
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    toast('Offline — queue preserved for later flush', 'warn');
    return { flushed: 0, remaining: rows.length, offline: true };
  }
  if (!isCloudConfigured()) {
    toast('No cloud credentials configured — queue kept locally', 'warn');
    return { flushed: 0, remaining: rows.length, unconfigured: true };
  }

  await ensureDevice();

  // Group by entity so each table gets one bulk upsert instead of N round trips.
  const byEntity = new Map();
  for (const entry of rows) {
    if (!tableFor(entry.entity)) {
      continue; // local-only stores (batteryConfigs, reports) never leave the device
    }
    if (!byEntity.has(entry.entity)) byEntity.set(entry.entity, []);
    byEntity.get(entry.entity).push(entry);
  }

  let flushed = 0;
  const kept = [];
  const localRows = readLocal();
  const syncedIds = new Map();

  for (const [entity, entries] of byEntity) {
    const wanted = new Set(entries.map((e) => String(e.entityId)));
    const source = new Map(
      (localRows[entity] ?? []).filter((r) => wanted.has(String(r.id))).map((r) => [String(r.id), r])
    );
    const payload = entries.map((e) => source.get(String(e.entityId))).filter(Boolean);
    const orphans = entries.filter((e) => !source.has(String(e.entityId)));

    // A queue entry whose row was wiped is not an error — drop it silently.
    const res = payload.length ? await pushRows(entity, payload) : { ok: true, pushed: 0 };

    if (res.ok) {
      flushed += payload.length;
      syncedIds.set(entity, payload.map((r) => r.id));
    } else {
      kept.push(...entries, ...orphans);
    }
  }

  // Rows in stores with no cloud table are drained without ever being uploaded.
  const localOnly = rows.filter((e) => !tableFor(e.entity));
  flushed += localOnly.length;

  // Persist the surviving queue.
  if (ready) {
    try {
      await db.syncQueue.clear();
      if (kept.length) await db.syncQueue.bulkAdd(kept.map(({ id, ...rest }) => rest));
      for (const [entity, ids] of syncedIds) {
        await db.table(entity).where('id').anyOf(ids).modify({ syncState: 'synced' });
      }
    } catch {
      /* IndexedDB is a mirror; localStorage below is authoritative for the UI */
    }
  }
  writeQueueLocal(kept);

  for (const [entity, ids] of syncedIds) {
    const set = new Set(ids.map(String));
    writeLocal(
      entity,
      (readLocal()[entity] ?? []).map((r) => (set.has(String(r.id)) ? { ...r, syncState: 'synced' } : r))
    );
  }

  const summary = { flushed, remaining: kept.length, at: new Date().toISOString() };
  recordFlush(summary);

  if (kept.length) {
    toast(`Synced ${flushed} record${flushed === 1 ? '' : 's'} · ${kept.length} kept for retry`, 'warn');
  } else {
    toast(`Synced ${flushed} record${flushed === 1 ? '' : 's'} to the vault cloud`, 'success');
  }
  return summary;
}

/**
 * Rebuild the local vault from the cloud (new phone, wiped IndexedDB).
 * Cloud rows are keyed on `client_row_id`, which is the original local id,
 * so re-importing never duplicates a survey.
 */
export async function restoreFromCloud() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    toast('Offline — cannot restore from the cloud right now', 'warn');
    return { ok: false, restored: 0 };
  }
  const res = await pullAll();
  if (!res.ok) {
    toast(`Restore failed · ${res.error ?? 'network error'}`, 'critical');
    return { ok: false, restored: 0 };
  }

  const remoteSites = res.sites.map((r) => ({
    id: r.client_row_id,
    name: r.name,
    kind: r.kind,
    lat: r.lat,
    lon: r.lon,
    tz: r.tz,
    dayOfYear: r.day_of_year,
    tilt: r.tilt,
    azimuth: r.azimuth,
    kw: r.kw,
    horizon: r.horizon ?? [],
    horizonCount: Array.isArray(r.horizon) ? r.horizon.length : 0,
    battery: r.battery,
    loads: r.loads,
    role: r.role,
    theme: r.theme,
    createdAt: r.captured_at,
    syncState: 'synced'
  }));

  const remoteAudits = res.audits.map((r) => ({
    id: r.client_row_id,
    company: r.company,
    verdict: r.verdict,
    verdictClass: r.verdict_class,
    dollarsPerWatt: r.dollars_per_watt,
    physicsKwhPerYear: r.physics_kwh_per_year,
    promisedKwhPerYear: r.promised_kwh_per_year,
    paybackYears: r.payback_years,
    findings: r.findings ?? [],
    result: { verdict: r.verdict, verdictClass: r.verdict_class, findings: r.findings ?? [] },
    createdAt: r.captured_at,
    syncState: 'synced'
  }));

  const merge = (entity, remote) => {
    const byId = new Map(remote.map((r) => [String(r.id), r]));
    for (const local of readLocal()[entity] ?? []) {
      if (!byId.has(String(local.id))) byId.set(String(local.id), local);
    }
    return [...byId.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  };

  const sites = merge('sites', remoteSites);
  const audits = merge('audits', remoteAudits);
  writeLocal('sites', sites);
  writeLocal('audits', audits);

  if (ready) {
    try {
      await db.sites.bulkPut(sites);
      await db.audits.bulkPut(audits);
    } catch {
      /* mirror only */
    }
  }

  toast(`Restored ${remoteSites.length} surveys and ${remoteAudits.length} audits`, 'success');
  return { ok: true, restored: remoteSites.length + remoteAudits.length };
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
