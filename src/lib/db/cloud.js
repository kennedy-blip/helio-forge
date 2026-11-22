/**
 * HELIO-FORGE — Supabase cloud transport for the Site Vault
 * ============================================================================
 * The vault is offline-first: IndexedDB is authoritative and this module is
 * only ever called by the sync queue. Nothing here throws — every function
 * returns `{ ok, ... }` so a dead network can never break a save.
 *
 * SECURITY MODEL
 * --------------
 * There is no login yet, so each install mints a UUID once and stores it. That
 * UUID is sent in the `x-helio-device` header, and every row's RLS policy
 * requires `device_id = helio_current_device()`. A device can therefore read
 * and write only its own rows, even though the publishable key is public.
 * Treat the UUID as a bearer token: it is stored in localStorage and mirrored
 * into IndexedDB, never logged in full.
 *
 * CONFIGURATION
 * -------------
 * 1. `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` at build time, or
 * 2. a runtime override in localStorage (`helioforge.cloud.v1`) — this is what
 *    makes the same static bundle work in the APK without a rebuild, or
 * 3. the compiled-in defaults below (publishable key only — never a secret).
 */

// @ts-nocheck — validated by scripts/kernel-parity.mjs instead of the TS checker

export const CLOUD_DEFAULTS = {
  url: 'https://suaukmetnxjciwmejofj.supabase.co',
  anonKey: 'sb_publishable_FsTvXZtPk-2OWp4h9tWy_Q_0C7qJmcS'
};

const CFG_KEY = 'helioforge.cloud.v1';
const DEVICE_KEY = 'helioforge.device.v1';
const LAST_FLUSH_KEY = 'helioforge.cloud.lastflush.v1';

const TABLES = {
  sites: 'helio_site_surveys',
  audits: 'helio_quote_audits',
  batteryConfigs: null,
  reports: null
};

/* --------------------------------------------------------------- config */

function envValue(name) {
  try {
    return import.meta.env?.[name] ?? '';
  } catch {
    return '';
  }
}

/** @returns {{url: string, anonKey: string, source: 'env'|'local'|'default'|'none'}} */
export function cloudConfig() {
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = JSON.parse(localStorage.getItem(CFG_KEY) ?? 'null');
      if (raw?.url && raw?.anonKey) {
        return { url: raw.url.replace(/\/+$/, ''), anonKey: raw.anonKey, source: 'local' };
      }
    } catch {
      /* fall through */
    }
  }
  const url = envValue('VITE_SUPABASE_URL');
  const anonKey = envValue('VITE_SUPABASE_ANON_KEY');
  if (url && anonKey) return { url: url.replace(/\/+$/, ''), anonKey, source: 'env' };
  if (CLOUD_DEFAULTS.url && CLOUD_DEFAULTS.anonKey) {
    return { ...CLOUD_DEFAULTS, source: 'default' };
  }
  return { url: '', anonKey: '', source: 'none' };
}

/** Persist a runtime override (used by the vault UI / APK settings panel). */
export function setCloudConfig(url, anonKey) {
  if (typeof localStorage === 'undefined') return false;
  try {
    if (!url || !anonKey) {
      localStorage.removeItem(CFG_KEY);
      return true;
    }
    localStorage.setItem(CFG_KEY, JSON.stringify({ url: url.trim(), anonKey: anonKey.trim() }));
    return true;
  } catch {
    return false;
  }
}

export function isCloudConfigured() {
  const cfg = cloudConfig();
  return Boolean(cfg.url && cfg.anonKey);
}

/* -------------------------------------------------------------- identity */

function uuidv4() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Stable per-install device id — the RLS bearer token. */
export function deviceId() {
  if (typeof localStorage === 'undefined') return uuidv4();
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const fresh = uuidv4();
    localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    return uuidv4();
  }
}

export function shortDeviceId() {
  return deviceId().slice(0, 8);
}

export function platformLabel() {
  if (typeof window === 'undefined') return 'server';
  if (window.Capacitor?.isNativePlatform?.()) return `capacitor-${window.Capacitor.getPlatform?.() ?? 'native'}`;
  return 'web';
}

/* ------------------------------------------------------------ transport */

function headers(cfg, extra = {}) {
  return {
    apikey: cfg.anonKey,
    Authorization: `Bearer ${cfg.anonKey}`,
    'Content-Type': 'application/json',
    'x-helio-device': deviceId(),
    ...extra
  };
}

async function rest(path, { method = 'GET', body, prefer, timeoutMs = 12000 } = {}) {
  const cfg = cloudConfig();
  if (!cfg.url || !cfg.anonKey) return { ok: false, status: 0, error: 'cloud not configured' };

  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
  try {
    const res = await fetch(`${cfg.url}/rest/v1/${path}`, {
      method,
      headers: headers(cfg, prefer ? { Prefer: prefer } : {}),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ac?.signal
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const message = data?.message ?? data?.hint ?? `HTTP ${res.status}`;
      return { ok: false, status: res.status, error: message, data };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    return { ok: false, status: 0, error: aborted ? 'request timed out' : (err?.message ?? 'network error') };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* --------------------------------------------------------------- mapping */

function isoOrNow(value) {
  const d = value ? new Date(value) : new Date();
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** @param {any} row IndexedDB site row */
export function siteToWire(row) {
  return {
    device_id: deviceId(),
    client_row_id: String(row.id),
    name: row.name ?? 'Custom Site',
    kind: row.kind ?? 'site-audit',
    lat: num(row.lat) ?? 0,
    lon: num(row.lon) ?? 0,
    tz: num(row.tz),
    day_of_year: num(row.dayOfYear),
    tilt: num(row.tilt),
    azimuth: num(row.azimuth),
    kw: num(row.kw),
    horizon: Array.isArray(row.horizon) ? row.horizon : [],
    battery: row.battery ?? null,
    loads: row.loads ?? null,
    role: row.role ?? null,
    theme: row.theme ?? null,
    captured_at: isoOrNow(row.createdAt)
  };
}

export function auditToWire(row) {
  const res = row.result ?? row;
  return {
    device_id: deviceId(),
    client_row_id: String(row.id),
    company: row.company ?? 'Unknown installer',
    verdict: row.verdict ?? res.verdict ?? null,
    verdict_class: row.verdictClass ?? res.verdictClass ?? null,
    dollars_per_watt: num(row.dollarsPerWatt ?? res.dollarsPerWatt),
    physics_kwh_per_year: num(row.physicsKwhPerYear ?? res.physicsKwhPerYear),
    promised_kwh_per_year: num(row.promisedKwhPerYear ?? res.promisedKwhPerYear),
    payback_years: num(row.paybackYears ?? res.paybackYears),
    findings: row.findings ?? res.findings ?? [],
    captured_at: isoOrNow(row.createdAt)
  };
}

/* ----------------------------------------------------------------- calls */

export function tableFor(store) {
  return TABLES[store] ?? null;
}

/** Register (or refresh) this device. Idempotent. */
export async function ensureDevice() {
  const cfg = cloudConfig();
  if (!cfg.url || !cfg.anonKey) return { ok: false, error: 'cloud not configured' };
  const now = new Date().toISOString();
  return rest('helio_devices?on_conflict=id', {
    method: 'POST',
    body: [
      {
        id: deviceId(),
        label: `${platformLabel()} · HelioForge`,
        platform: platformLabel(),
        last_seen_at: now
      }
    ],
    prefer: 'resolution=merge-duplicates,return=minimal'
  });
}

/** Push a single vault row. Returns `{ ok, skipped }` so the queue can decide. */
export async function pushRow(store, row) {
  const table = tableFor(store);
  if (!table) return { ok: true, skipped: 'store has no cloud table' };

  const wire = store === 'sites' ? siteToWire(row) : auditToWire(row);
  return rest(`${table}?on_conflict=device_id,client_row_id`, {
    method: 'POST',
    body: [wire],
    prefer: 'resolution=merge-duplicates,return=minimal'
  });
}

export async function pushRows(store, rows) {
  const table = tableFor(store);
  if (!table) return { ok: true, skipped: 'store has no cloud table' };
  if (!rows.length) return { ok: true, pushed: 0 };

  const body = rows.map((r) => (store === 'sites' ? siteToWire(r) : auditToWire(r)));
  const res = await rest(`${table}?on_conflict=device_id,client_row_id`, {
    method: 'POST',
    body,
    prefer: 'resolution=merge-duplicates,return=minimal'
  });
  return { ...res, pushed: body.length };
}

/** Pull everything this device owns (used to rebuild a wiped IndexedDB). */
export async function pullAll() {
  const [sites, audits] = await Promise.all([
    rest('helio_site_surveys?select=*&order=captured_at.desc&limit=500'),
    rest('helio_quote_audits?select=*&order=captured_at.desc&limit=200')
  ]);
  if (!sites.ok || !audits.ok) {
    return { ok: false, error: sites.error ?? audits.error };
  }
  return { ok: true, sites: sites.data ?? [], audits: audits.data ?? [] };
}

/** Cheap reachability probe for the vault status chip. */
export async function cloudHealth() {
  const cfg = cloudConfig();
  if (!cfg.url || !cfg.anonKey) {
    return { ok: false, configured: false, source: cfg.source, error: 'not configured' };
  }
  const res = await rest('helio_site_surveys?select=id&limit=1', { timeoutMs: 8000 });
  return {
    ok: res.ok,
    configured: true,
    source: cfg.source,
    host: cfg.url.replace(/^https?:\/\//, '').split('.')[0],
    device: shortDeviceId(),
    error: res.ok ? null : res.error
  };
}

export function recordFlush(summary) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LAST_FLUSH_KEY, JSON.stringify({ at: new Date().toISOString(), ...summary }));
  } catch {
    /* ignore */
  }
}

export function lastFlush() {
  if (typeof localStorage === 'undefined') return null;
  try {
    return JSON.parse(localStorage.getItem(LAST_FLUSH_KEY) ?? 'null');
  } catch {
    return null;
  }
}

export { rest as _rest };
