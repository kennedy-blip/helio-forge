/**
 * HELIO-FORGE — Polyglot ephemeris client
 * ============================================================================
 * Three-tier resolution chain, always succeeds:
 *
 *   1. ONLINE    Vercel Python 3.12 serverless  /api/helio_ephemeris
 *   2. WASM      Pyodide bridge (if it has been warmed — offline parity)
 *   3. LOCAL     deterministic JS mirror of helio_kernel.py (always available)
 *
 * Every response is tagged with `engine` so the Polyglot Runtime Inspector can
 * show exactly which language produced the number on screen.
 */

// @ts-nocheck — validated by scripts/kernel-parity.mjs instead of the TS checker

import * as K from './kernel.js';
import { app } from '$lib/state/app.svelte.js';
import { runPython } from './pyodideBridge.js';

const ENDPOINT = '/api/helio_ephemeris';

/** In-memory response cache — repeated slider moves never re-hit the network. */
const cache = new Map();
const CACHE_LIMIT = 180;

function cacheKey(action, params) {
  const keys = Object.keys(params).sort();
  return `${action}|${JSON.stringify(keys.map((k) => [k, params[k]]))}`;
}

function remember(key, value) {
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, value);
  return value;
}

function noteEngine(engine, ms) {
  const isPython = engine.includes('python');
  const isWasm = engine.includes('pyodide');
  app.kernelBench = {
    ...app.kernelBench,
    ...(isPython && !isWasm ? { pythonMs: ms } : {}),
    ...(isWasm ? { wasmMs: ms, wasmReady: true } : {}),
    ...(!isPython ? { jsMs: ms } : {}),
    source: isWasm ? 'wasm' : engine.includes('serverless') ? 'online' : 'offline',
    engine
  };
  app.lastKernel = { engine, ms, at: Date.now() };
}

/** Warm the offline Python WASM bridge and report through app state. */
export async function warmWasm() {
  const { warmPyodide, bridgeState } = await import('./pyodideBridge.js');
  const ok = await warmPyodide((msg) => {
    app.kernelBench = { ...app.kernelBench, wasmMessage: msg };
  });
  app.kernelBench = {
    ...app.kernelBench,
    wasmReady: ok,
    wasmMs: ok ? app.kernelBench.wasmMs : null,
    wasmMessage: ok ? `${bridgeState.interpreter} · ${(bridgeState.kernelBytes / 1024).toFixed(0)} KB kernel` : bridgeState.error
  };
  return ok;
}

/* ------------------------------------------------------- local JS dispatch */

const LOCAL = {
  health: () => ({
    ok: true,
    service: 'helio-ephemeris',
    version: '1.0.0',
    kernel: 'helio_kernel.js@offline-mirror',
    parityToleranceDeg: 0.01
  }),
  position: (p) => {
    const pos = K.solarPosition(p.lat, p.lon, { doy: p.doy, utcMinutes: p.minutes });
    const sky = K.clearSkyIrradiance(pos.elevation);
    return { ...pos, ...sky };
  },
  ephemeris: (p) => K.ephemerisPayload(p),
  annual: (p) =>
    K.annualYield(p.latitude, p.longitude, p.kw, p.tilt ?? K.optimalTilt(p.latitude, p.doy ?? 172, 'fixed'), p.panelAzimuth ?? 180, {
      ambientC: p.ambientC ?? 25,
      mount: p.mount ?? 'roof',
      gammaPctPerC: p.gammaPctPerC ?? -0.38,
      horizon: p.horizon ?? null,
      years: p.years ?? 25
    }),
  arcs: (p) => K.solsticeArcs(p.latitude, p.longitude, { stepMinutes: p.stepMinutes ?? 10 }),
  'irradiance-curve': (p) =>
    K.annualIrradianceCurve(p.latitude, p.longitude, p.tilt ?? K.optimalTilt(p.latitude, 172, 'fixed'), p.panelAzimuth ?? 180, p.horizon ?? null),
  quote: (p) => K.auditQuote(p),
  autonomy: (p) =>
    K.batteryAutonomy(p.chemistry, p.capacityAh, p.voltage, p.loadWatts, {
      dodPct: p.dodPct,
      inverterEfficiencyPct: p.inverterEfficiencyPct,
      temperatureC: p.temperatureC
    }),
  strings: (p) => K.stringSizing(p),
  soc: (p) =>
    K.simulateSoc(p.chemistry, p.capacityAh, p.voltage, p.loads ?? [], p.arrayKw, p.tilt, p.panelAzimuth ?? 180, p.latitude, p.longitude, p.doy, {
      dodPct: p.dodPct ?? 80,
      inverterEfficiencyPct: p.inverterEfficiencyPct ?? 92,
      initialSocPct: p.initialSocPct ?? 100,
      ambientC: p.ambientC ?? 25,
      horizon: p.horizon ?? null,
      hours: p.hours ?? 48
    }),
  shade: (p) => K.horizonEfficiency(p.latitude, p.longitude, p.horizon ?? [], p.tilt, p.panelAzimuth ?? 180),
  daylight: (p) => ({
    ...K.daylightHours(p.lat, p.doy),
    optimalTilt: {
      today: K.optimalTilt(p.lat, p.doy, 'today'),
      fixed: K.optimalTilt(p.lat, p.doy, 'fixed'),
      winter: K.optimalTilt(p.lat, p.doy, 'winter'),
      summer: K.optimalTilt(p.lat, p.doy, 'summer'),
      annual: K.optimalTilt(p.lat, p.doy, 'annual')
    }
  })
};

function runLocal(action, params) {
  const fn = LOCAL[action] ?? LOCAL.health;
  return fn(normalizeParams(action, params));
}

/** The Python API uses different key names for a few actions — normalise both ways. */
function toPythonParams(action, p) {
  const map = {
    position: () => ({ lat: p.lat, lon: p.lon, doy: p.doy, minutes: p.minutes }),
    ephemeris: () => ({
      lat: p.latitude,
      lon: p.longitude,
      doy: p.doy,
      tilt: p.tilt,
      azimuth: p.panelAzimuth,
      tz: p.timezoneOffsetHours,
      kw: p.kwStc,
      horizon: p.horizon ? JSON.stringify(p.horizon) : undefined
    }),
    annual: () => ({
      lat: p.latitude,
      lon: p.longitude,
      kw: p.kw,
      tilt: p.tilt,
      azimuth: p.panelAzimuth,
      ambient: p.ambientC,
      gamma: p.gammaPctPerC,
      mount: p.mount,
      years: p.years,
      horizon: p.horizon ? JSON.stringify(p.horizon) : undefined
    }),
    arcs: () => ({ lat: p.latitude, lon: p.longitude, step: p.stepMinutes }),
    'irradiance-curve': () => ({
      lat: p.latitude,
      lon: p.longitude,
      tilt: p.tilt,
      azimuth: p.panelAzimuth
    }),
    quote: () => ({
      lat: p.latitude,
      lon: p.longitude,
      systemKw: p.systemKw,
      quotedPrice: p.quotedPriceUsd,
      promisedKwh: p.promisedKwhPerYear,
      utilityRate: p.utilityRateUsd,
      tilt: p.tilt ?? -1,
      azimuth: p.panelAzimuth ?? 180,
      horizon: p.horizon ? JSON.stringify(p.horizon) : undefined
    }),
    autonomy: () => ({
      chemistry: p.chemistry,
      capacityAh: p.capacityAh,
      voltage: p.voltage,
      loadWatts: p.loadWatts,
      dod: p.dodPct,
      inverter: p.inverterEfficiencyPct,
      temperature: p.temperatureC
    }),
    strings: () => ({
      panelVoc: p.panelVoc,
      panelVmp: p.panelVmp,
      panelIsc: p.panelIsc,
      panelWatt: p.panelWatt,
      series: p.panelsSeries,
      parallel: p.stringsParallel,
      controllerMaxVoc: p.controllerMaxVoc,
      mpptLow: p.controllerMpptLow,
      mpptHigh: p.controllerMpptHigh,
      maxAmps: p.controllerMaxAmps,
      recordLowC: p.recordLowC
    }),
    soc: () => ({
      chemistry: p.chemistry,
      capacityAh: p.capacityAh,
      voltage: p.voltage,
      loads: p.loads,
      arrayKw: p.arrayKw,
      tilt: p.tilt,
      azimuth: p.panelAzimuth,
      lat: p.latitude,
      lon: p.longitude,
      doy: p.doy,
      dod: p.dodPct,
      inverter: p.inverterEfficiencyPct,
      initialSoc: p.initialSocPct,
      horizon: p.horizon ? JSON.stringify(p.horizon) : undefined,
      hours: p.hours
    }),
    shade: () => ({
      lat: p.latitude,
      lon: p.longitude,
      horizon: JSON.stringify(p.horizon ?? []),
      tilt: p.tilt,
      azimuth: p.panelAzimuth
    }),
    daylight: () => ({ lat: p.lat, doy: p.doy })
  };
  return (map[action] ?? (() => p))();
}

/** Local mirror takes the camelCase vocabulary; accept both spellings. */
function normalizeParams(action, p) {
  if (action === 'ephemeris') {
    return {
      latitude: p.latitude ?? p.lat,
      longitude: p.longitude ?? p.lon,
      doy: p.doy,
      tilt: p.tilt,
      panelAzimuth: p.panelAzimuth ?? p.azimuth ?? 180,
      timezoneOffsetHours: p.timezoneOffsetHours ?? p.tz ?? 0,
      horizon: p.horizon ?? null,
      kwStc: p.kwStc ?? p.kw ?? 1
    };
  }
  if (action === 'annual') {
    return {
      ...p,
      latitude: p.latitude ?? p.lat,
      longitude: p.longitude ?? p.lon,
      doy: p.doy ?? 172
    };
  }
  if (action === 'arcs') {
    return { latitude: p.latitude ?? p.lat, longitude: p.longitude ?? p.lon, stepMinutes: p.stepMinutes ?? p.step };
  }
  if (action === 'irradiance-curve') {
    return { ...p, latitude: p.latitude ?? p.lat, longitude: p.longitude ?? p.lon };
  }
  if (action === 'shade') {
    return { ...p, latitude: p.latitude ?? p.lat, longitude: p.longitude ?? p.lon };
  }
  return p;
}

/* ------------------------------------------------------------ fetch helpers */

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

/**
 * Main entry point. Always resolves — never throws — so a blacked-out grid
 * can never blank the UI.
 */
export async function ephemeris(action, params = {}, { preferOnline = true, timeout = 8000 } = {}) {
  const key = cacheKey(action, params);
  if (cache.has(key)) return cache.get(key);

  // Tier 0: an already-warm Pyodide interpreter is *real Python* running offline.
  // It is preferred over the JS mirror because it executes the same kernel source
  // that the Vercel function ships.
  if (preferOnline && typeof window !== 'undefined' && app.kernelBench.wasmReady) {
    const res = await runPython(action, params);
    if (res.ok) {
      noteEngine(res.engine, res.ms);
      return remember(key, { ok: true, engine: res.engine, ms: res.ms, payload: res.payload, action });
    }
  }

  if (preferOnline && typeof fetch === 'function' && typeof navigator !== 'undefined' && navigator.onLine !== false) {
    const { signal, clear } = withTimeout(timeout);
    const t0 = performance.now();
    try {
      const query = new URLSearchParams({ action });
      const py = toPythonParams(action, params);
      for (const [k, v] of Object.entries(py)) {
        if (v === undefined || v === null) continue;
        query.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      }
      const res = await fetch(`${ENDPOINT}?${query}`, { signal, headers: { Accept: 'application/json' } });
      clear();
      if (res.ok) {
        const json = await res.json();
        if (json.ok) {
          const ms = performance.now() - t0;
          noteEngine(json.engine ?? 'python3.12-serverless', ms);
          return remember(key, {
            ok: true,
            engine: json.engine ?? 'python3.12-serverless',
            ms,
            payload: json.payload,
            action
          });
        }
      }
    } catch {
      clear();
      /* fall through to the local mirror */
    }
  }

  const t0 = performance.now();
  const payload = runLocal(action, params);
  const ms = performance.now() - t0;
  noteEngine('local-kernel-js', ms);
  return remember(key, { ok: true, engine: 'local-kernel-js', ms, payload, action });
}

/** Synchronous local-only variant for render loops (60fps safe). */
export function local(action, params = {}) {
  return runLocal(action, params);
}

export function clearCache() {
  cache.clear();
}

/** Round-trip benchmark: Python serverless vs local JS mirror. */
export async function benchmark() {
  const params = { latitude: 30.2672, longitude: -97.7431, doy: 172, tilt: 30, panelAzimuth: 180 };
  const t0 = performance.now();
  const py = await ephemeris('ephemeris', params, { preferOnline: true });
  const pythonMs = performance.now() - t0;
  const t1 = performance.now();
  runLocal('ephemeris', params);
  const jsMs = performance.now() - t1;
  app.kernelBench = {
    ...app.kernelBench,
    pythonMs: +pythonMs.toFixed(2),
    jsMs: +jsMs.toFixed(2),
    deltaMs: +(pythonMs - jsMs).toFixed(2),
    source: py.engine.includes('pyodide') ? 'wasm' : py.engine.includes('python') ? 'online' : 'offline',
    engine: py.engine
  };
  return app.kernelBench;
}
