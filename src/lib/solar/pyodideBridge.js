/**
 * HELIO-FORGE — Pyodide / WebAssembly offline bridge
 * ============================================================================
 * Runs the *actual* `src/lib/python/helio_kernel.py` inside the browser via
 * Pyodide, so the APK and air-gapped mode execute the same Python source as the
 * Vercel function — not a re-implementation.
 *
 *   await warmPyodide();                 // lazy, ~6 s, cached by the browser
 *   const out = await runPython('position', { lat: 30, lon: -97, doy: 172, minutes: 720 });
 *
 * Strategy
 * --------
 *  1. Load Pyodide from the official CDN (only when the user asks / is online).
 *  2. Feed it the raw kernel source bundled with the app (`?raw`), so the WASM
 *     interpreter needs no filesystem or network for the physics.
 *  3. Cache the interpreter instance — subsequent calls are sub-millisecond.
 *
 * If Pyodide is unreachable (blackout, no CDN), everything transparently falls
 * back to the deterministic JS mirror in `kernel.js`. The UI never breaks.
 */

import kernelSource from '$lib/python/helio_kernel.py?raw';

const PYODIDE_VERSION = '0.26.4';
const CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.mjs`;

let pyodide = null;
let loadingPromise = null;
let moduleReady = false;
let lastError = null;

/** Bridge status for the Polyglot Runtime Inspector. */
export const bridgeState = {
  get ready() {
    return moduleReady;
  },
  get loading() {
    return loadingPromise !== null && !moduleReady;
  },
  get error() {
    return lastError;
  },
  get interpreter() {
    return pyodide ? `Pyodide ${PYODIDE_VERSION} (WASM)` : 'not loaded';
  },
  get kernelBytes() {
    return new Blob([kernelSource]).size;
  }
};

async function bootInterpreter() {
  if (pyodide) return pyodide;
  const mod = await import(/* @vite-ignore */ CDN);
  const instance = await mod.loadPyodide({
    indexURL: `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`,
    stdout: () => {},
    stderr: () => {}
  });

  // Write the exact Python kernel into the WASM virtual FS and import it.
  instance.FS.writeFile('/helio_kernel.py', kernelSource);
  await instance.runPythonAsync(`
import sys, json
sys.path.insert(0, '/')
import helio_kernel
_HELIO = helio_kernel
`);

  pyodide = instance;
  moduleReady = true;
  return instance;
}

/**
 * Warm the WASM bridge. Safe to call repeatedly and safe to ignore.
 * @returns {Promise<boolean>} true when Python is live in this tab
 */
export async function warmPyodide(onProgress) {
  if (moduleReady) return true;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      onProgress?.('downloading Pyodide runtime…');
      await bootInterpreter();
      onProgress?.('helio_kernel.py loaded into WASM');
      return true;
    } catch (err) {
      lastError = String(err?.message ?? err);
      moduleReady = false;
      return false;
    } finally {
      loadingPromise = null;
    }
  })();

  return loadingPromise;
}

const ACTION_EXPR = {
  health: () => `_HELIO.__dict__ and {"ok": True}`,
  position: (p) =>
    `_HELIO.solar_position(${num(p.lat)}, ${num(p.lon)}, doy=${p.doy | 0}, utc_minutes=${num(p.minutes)})`,
  ephemeris: (p) =>
    `_HELIO.ephemeris_payload(${num(p.latitude)}, ${num(p.longitude)}, ${p.doy | 0}, tilt=${num(p.tilt ?? 0, true)}, panel_azimuth=${num(p.panelAzimuth ?? 180)}, horizon=${pyHorizon(p.horizon)})`,
  annual: (p) =>
    `_HELIO.annual_yield(${num(p.latitude)}, ${num(p.longitude)}, ${num(p.kw)}, ${num(p.tilt ?? 0, true)}, panel_azimuth=${num(p.panelAzimuth ?? 180)}, years=${p.years ?? 25}, horizon=${pyHorizon(p.horizon)})`,
  autonomy: (p) =>
    `_HELIO.battery_autonomy(${JSON.stringify(p.chemistry ?? 'lifepo4')}, ${num(p.capacityAh)}, ${num(p.voltage)}, ${num(p.loadWatts)}, dod_pct=${num(p.dodPct ?? 80)}, inverter_efficiency_pct=${num(p.inverterEfficiencyPct ?? 92)}, temperature_c=${num(p.temperatureC ?? 25)})`,
  strings: (p) =>
    `_HELIO.string_sizing(${num(p.panelVoc)}, ${num(p.panelVmp)}, ${num(p.panelIsc)}, ${num(p.panelWatt)}, ${p.panelsSeries | 0}, ${p.stringsParallel | 0}, ${num(p.controllerMaxVoc)}, ${num(p.controllerMpptLow)}, ${num(p.controllerMpptHigh)}, ${num(p.controllerMaxAmps)}, record_low_c=${num(p.recordLowC ?? -15)})`,
  shade: (p) =>
    `_HELIO.horizon_efficiency(${num(p.latitude)}, ${num(p.longitude)}, ${pyHorizon(p.horizon)}, ${num(p.tilt)}, ${num(p.panelAzimuth ?? 180)})`,
  daylight: (p) =>
    `_HELIO.daylight_hours(${num(p.lat)}, ${p.doy | 0})`,
  soc: (p) =>
    `_HELIO.simulate_soc(${JSON.stringify(p.chemistry ?? 'lifepo4')}, ${num(p.capacityAh)}, ${num(p.voltage)}, ${pyLoads(p.loads)}, ${num(p.arrayKw)}, ${num(p.tilt)}, ${num(p.panelAzimuth ?? 180)}, ${num(p.latitude)}, ${num(p.longitude)}, ${p.doy | 0}, hours=${p.hours ?? 48})`
};

function num(v, nullable = false) {
  if (nullable && (v === null || v === undefined)) return 'None';
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : 'None';
}

function pyHorizon(horizon) {
  if (!horizon || !horizon.length) return 'None';
  const items = horizon
    .map((h) => `{"azimuth": ${num(h.azimuth)}, "elevation": ${num(h.elevation)}}`)
    .join(', ');
  return `[${items}]`;
}

function pyLoads(loads) {
  if (!loads || !loads.length) return '[]';
  const items = loads
    .map((l) => `{"watts": ${num(l.watts)}, "hoursPerDay": ${num(l.hoursPerDay)}}`)
    .join(', ');
  return `[${items}]`;
}

/**
 * Execute one kernel action inside Pyodide.
 * @returns {Promise<{ok: boolean, engine: string, ms: number, payload?: any, error?: string}>}
 */
export async function runPython(action, params = {}) {
  const t0 = performance.now();
  const warmed = await warmPyodide();
  if (!warmed) {
    return { ok: false, engine: 'pyodide-wasm', ms: 0, error: lastError ?? 'pyodide unavailable' };
  }
  try {
    const builder = ACTION_EXPR[action];
    if (!builder) throw new Error(`unknown python action '${action}'`);
    const expr = `json.dumps(${builder(params)}, allow_nan=False)`;
    const raw = await pyodide.runPythonAsync(`import json\n${expr}`);
    return {
      ok: true,
      engine: 'pyodide-wasm-python3.12',
      ms: +(performance.now() - t0).toFixed(2),
      payload: JSON.parse(raw)
    };
  } catch (err) {
    lastError = String(err?.message ?? err);
    return { ok: false, engine: 'pyodide-wasm', ms: 0, error: lastError };
  }
}

/** Run an arbitrary snippet against the loaded kernel — used by the inspector. */
export async function evalPython(code) {
  if (!(await warmPyodide())) throw new Error(lastError ?? 'pyodide unavailable');
  return pyodide.runPythonAsync(code);
}
