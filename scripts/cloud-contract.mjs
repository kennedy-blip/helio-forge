/**
 * HELIO-FORGE — cloud sync contract check
 * ============================================================================
 *   node scripts/cloud-contract.mjs
 *
 * The Supabase client cannot be exercised from Node (no `$lib`, no Vite env),
 * so this harness locks down the two things that silently rot:
 *
 *   1. the row mappers in src/lib/db/cloud.js still emit every column the
 *      PostgREST tables declare, with the right shape and null discipline;
 *   2. flushQueue() in src/lib/db/vault.js still deletes a queue entry only
 *      after a successful push — the property that makes the vault safe when
 *      a browser dies mid-upload.
 *
 * Exits non-zero on any failure so CI can gate on it.
 */

import { readFileSync } from 'node:fs';

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ ok: true, name, detail });
  } catch (err) {
    results.push({ ok: false, name, detail: err.message });
  }
}
function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const { siteToWire, auditToWire, deviceId, cloudConfig, tableFor } = await import(
  '../src/lib/db/cloud.js'
);

/* ------------------------------------------------------------ schema shape */

// Column lists mirror public.helio_site_surveys / public.helio_quote_audits.
const SITE_COLUMNS = [
  'device_id', 'client_row_id', 'name', 'kind', 'lat', 'lon', 'tz', 'day_of_year',
  'tilt', 'azimuth', 'kw', 'horizon', 'battery', 'loads', 'role', 'theme', 'captured_at'
];
const AUDIT_COLUMNS = [
  'device_id', 'client_row_id', 'company', 'verdict', 'verdict_class',
  'dollars_per_watt', 'physics_kwh_per_year', 'promised_kwh_per_year',
  'payback_years', 'findings', 'captured_at'
];

const sampleSite = {
  id: 12,
  name: 'Meru rooftop',
  kind: 'site-audit',
  lat: 0.0512,
  lon: 37.6457,
  tz: 3,
  dayOfYear: 325,
  tilt: 12.5,
  azimuth: 180,
  kw: 4.4,
  horizon: [{ az: 0, el: 0 }],
  battery: { chemistry: 'LiFePO4' },
  loads: { dailyWh: 9000 },
  role: 'engineer',
  theme: 'obsidian',
  createdAt: '2026-11-22T09:00:00.000Z'
};

const sampleAudit = {
  id: 7,
  company: 'Meru Solar Ltd',
  result: {
    verdict: 'NEGOTIATE BEFORE SIGNING',
    verdictClass: 'warn',
    dollarsPerWatt: 3.75,
    physicsKwhPerYear: 13034,
    promisedKwhPerYear: 19000,
    paybackYears: 15.1,
    findings: [{ code: 'PRICE' }]
  },
  createdAt: '2026-11-22T09:05:00.000Z'
};

await check('site mapper emits exactly the table columns', () => {
  const wire = siteToWire(sampleSite);
  const extra = Object.keys(wire).filter((k) => !SITE_COLUMNS.includes(k));
  const missing = SITE_COLUMNS.filter((k) => !(k in wire));
  assert(extra.length === 0, `unexpected columns: ${extra.join(', ')}`);
  assert(missing.length === 0, `missing columns: ${missing.join(', ')}`);
  return `${SITE_COLUMNS.length} columns`;
});

await check('audit mapper emits exactly the table columns', () => {
  const wire = auditToWire(sampleAudit);
  const extra = Object.keys(wire).filter((k) => !AUDIT_COLUMNS.includes(k));
  const missing = AUDIT_COLUMNS.filter((k) => !(k in wire));
  assert(extra.length === 0, `unexpected columns: ${extra.join(', ')}`);
  assert(missing.length === 0, `missing columns: ${missing.join(', ')}`);
  return `${AUDIT_COLUMNS.length} columns`;
});

await check('client_row_id is a string (bigint-safe for PostgREST)', () => {
  assert(siteToWire(sampleSite).client_row_id === '12', 'numeric id not stringified');
  assert(auditToWire(sampleAudit).client_row_id === '7', 'numeric id not stringified');
});

await check('non-numeric coordinates never reach the wire as NaN', () => {
  const wire = siteToWire({ ...sampleSite, lat: 'north', lon: undefined });
  assert(wire.lat === 0 && wire.lon === 0, `got lat=${wire.lat} lon=${wire.lon}`);
});

await check('horizon always serialises as an array', () => {
  assert(Array.isArray(siteToWire({ ...sampleSite, horizon: null }).horizon), 'null horizon');
  assert(Array.isArray(auditToWire({ ...sampleAudit, findings: null }).findings), 'null findings');
});

await check('audit mapper still works for an already-flattened row', () => {
  const wire = auditToWire({ id: 9, company: 'X', verdict: 'FAIR', dollarsPerWatt: 2.4 });
  assert(wire.verdict === 'FAIR' && wire.dollars_per_watt === 2.4, 'flattened row dropped');
});

await check('device id is a stable UUID across calls', () => {
  const a = deviceId();
  const b = deviceId();
  assert(a === b, 'device id not stable');
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(a), `bad uuid ${a}`);
  return a;
});

await check('every cloud-backed store resolves to a real table', () => {
  assert(tableFor('sites') === 'helio_site_surveys', 'sites table');
  assert(tableFor('audits') === 'helio_quote_audits', 'audits table');
  assert(tableFor('batteryConfigs') === null, 'batteryConfigs must stay local');
  assert(tableFor('reports') === null, 'reports must stay local');
});

await check('cloud config is present and never a secret', () => {
  const cfg = cloudConfig();
  assert(cfg.url.startsWith('https://'), `bad url ${cfg.url}`);
  assert(cfg.anonKey.startsWith('sb_publishable_'), 'expected a publishable key');
  assert(!cfg.anonKey.startsWith('sb_secret_'), 'a secret key leaked into the client');
});

/* ------------------------------------------------------ flush-queue safety */

await check('flushQueue only dequeues after a successful push', async () => {
  const src = readFileSync(new URL('../src/lib/db/vault.js', import.meta.url), 'utf8');
  const start = src.indexOf('export async function flushQueue');
  const end = src.indexOf('export async function restoreFromCloud');
  assert(start > -1 && end > start, 'flushQueue not found');
  const body = src.slice(start, end);

  assert(body.includes('pushRows('), 'flushQueue no longer uploads');
  assert(/if \(res\.ok\)/.test(body), 'flushQueue ignores the push result');
  assert(body.includes('kept.push'), 'failures are not retained for retry');
  assert(body.includes('writeQueueLocal(kept)'), 'retained queue not persisted');
  assert(
    body.indexOf('pushRows(') < body.indexOf('db.syncQueue.clear()'),
    'queue is cleared before the push is attempted'
  );
  assert(!/syncQueue\.clear\(\)[\s\S]*?modify\(\{ syncState: 'synced' \}\)/.test(body.split('if (res.ok)')[0]),
    'rows are marked synced before a confirmed push');
  return 'safe dequeue ordering';
});

/* ------------------------------------------------------------------ report */

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok && r.detail ? ` — ${r.detail}` : ''}`);
  if (!r.ok) console.log(`      ${r.detail}`);
}
console.log(
  `\n${results.length - failed.length}/${results.length} cloud contract checks passed`
);
process.exit(failed.length ? 1 : 0);
