# HELIO-FORGE

**Optical AR Solar-Path Heliodon · Horizon Shade Scanner · Photovoltaic Tilt Optimizer · Off-Grid Battery Autonomy Architect**

A polyglot solar-engineering workstation: **Svelte 5** reactive UI, **Python 3.12** ephemeris kernel (Vercel serverless **and** Pyodide/WASM offline), **WebGL2 GLSL** atmospheric dome + liquid-glass underlay, and a **Kotlin** Capacitor sensor bridge packaged into an offline Android `.APK`.

---

## What it actually does

| Module | Problem solved |
|---|---|
| **AR Sky Heliodon** | Project Jun-21 / equinox / Dec-21 solar arcs over a live camera feed or orbit a 3D glass dome; scan treelines and read **Solar Window Efficiency (0–100 %)** and the **Starlink 100° FOV** clearance. |
| **Panel Tilt Clinometer** | Compute **Solar Declination δ** and the optimal tilt for *today / fixed / winter / summer*, then hit a ±0.5° haptic lock with a **cosine-incidence η** gauge. Pro tier adds the **NOCT thermal derating lab** (γ = −0.38 %/°C). |
| **Off-Grid Battery Forge** | **Peukert's law** `t = H·(C/(I·H))^k` autonomy, DoD and inverter losses, a 48-hour **SoC waveform** with the predicted blackout hour, and a **cold-snap V_oc** MPPT string sizer. |
| **Solar Quote Auditor** | Cross-checks a sales quote against real latitude irradiance, scanned shading and 0.5 %/yr degradation → `FAIR ENGINEERING QUOTE` / `INFLATED PRODUCTION PROMISE` / `PREDATORY $/WATT OVERCHARGE`. |
| **Site Vault** | IndexedDB (Dexie) persistence with an offline→online sync queue, raw CSV/JSON irradiance export and the **Polyglot Runtime Inspector**. |

---

## Architecture

```
src/
  routes/+layout.svelte          glass shell, theme engine, depth-push modals
  routes/+page.svelte            module router
  lib/state/app.svelte.js        single $state store (Svelte 5 runes)
  lib/state/theme.svelte.js      4 field-environment token sets
  lib/solar/kernel.js            deterministic JS mirror of the Python kernel
  lib/solar/api.js               3-tier chain: WASM → Vercel Python → JS mirror
  lib/solar/pyodideBridge.js     real helio_kernel.py in WebAssembly (offline)
  lib/python/helio_kernel.py     ⭐ canonical physics (NOAA/NREL + ASHRAE + Peukert)
  lib/webgl/gl.js                WebGL2 runtime + 4×4 matrix math
  shaders/liquid_glass.glsl      atmospheric scattering + caustics underlay
  shaders/heliodon.glsl          glass solar dome: arcs, graticule, obstructions
  lib/components/…               HeliodonDome, ARCameraOverlay, ClinometerGauge,
                                 HorizonEditor, SocWaveform, MetaballDock, modals…
api/helio_ephemeris.py           Vercel Python 3.12 function (single handler)
android/app/src/main/java/com/helioforge/solar/HelioSensorPlugin.kt
scripts/kernel-parity.mjs        Python ⇄ JS parity harness (800 states)
```

### Physics used

* **NOAA / NREL SPA** solar position — Spencer declination, equation of time
* **ASHRAE** clear-sky DNI with **Kasten & Young (1989)** air mass
* Plane-of-array = beam + isotropic sky diffuse + ground-reflected
* **NOCT** cell temperature with wind cooling and mounting-gap factors
* Sandia/PVWatts loss chain: soiling, mismatch, wiring, inverter
* **Peukert** capacity law with chemistry-specific `k`, DoD, round-trip and cold derating
* Cold-weather `V_oc` spike: `Voc_cold = Voc_STC · (1 + β/100 · (T_cold − 25))`

### Offline guarantee

`npm run build` emits a fully static bundle (`adapter-static`) that runs with the radio off.
The Python API is an optimisation, never a dependency:

1. **Pyodide/WASM** — the exact `helio_kernel.py` source executed in WebAssembly
2. **Vercel Python 3.12** — serverless ephemeris (online only)
3. **JS mirror** — deterministic port, parity **≤ 8.6 × 10⁻¹⁴ °** across 800 sampled states

```bash
node scripts/kernel-parity.mjs
# ✓ PASS — Python and JS kernels agree within 0.01°
```

---

## Develop

```bash
npm install
python3 api/dev_server.py &        # local stand-in for the Vercel Python function
npm run dev                        # http://localhost:5173
```

`vite.config.js` proxies `/api/helio_ephemeris` → `127.0.0.1:8787`, so the online Python path is exercised locally.

```bash
npm run build       # static bundle into build/
npm run preview     # serve the production build
npm run check       # svelte-check
npm run apk:stub    # regenerate the release placeholder (valid ZIP, no 404s)
```

## Deploy to Vercel

`vercel.json` pins `api/helio_ephemeris.py` to the `python3.12` runtime with rewrites and immutable asset caching. Push and deploy — the Python function needs **zero** pip packages.

## Android APK

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleRelease
```

`.github/workflows/build-and-bundle-apk.yml` automates this (parity gate → build → cap sync → Gradle → copy to `static/releases/helioforge-release.apk` → commit → GitHub Release).

The one-tap download is **never a 404**: `scripts/make-apk-stub.mjs` pre-bundles a valid ZIP placeholder that CI overwrites with the signed APK. The APK Download Center verifies the artifact size and switches between *signed APK ready* / *placeholder bundle* / *manifest fallback*.

---

## Themes

| Theme | Intent |
|---|---|
| **Solar Obsidian** | Deep cosmic slate, gold/cyan/emerald refractive glass |
| **Desert High-Noon Frost** | Alabaster frosted glass, ultra-crisp dark type for roof glare |
| **Infrared Photovoltaic** | FLIR thermal UV + orange/magenta glass |
| **Eco-Glass / Low-GPU** | Blur layers paused, shader resolution reduced, locked 60 FPS |

## Privilege tiers

`OFF-GRID EXPLORER` → `SOLAR PV ENGINEER` → `MICROGRID SYSTEMS ARCHITECT`, with a live hardware permission matrix (camera, clinometer/compass, GPS, haptics, battery) that reflects real `getUserMedia` / `DeviceOrientationEvent` / `geolocation` acquisition.

---

## License

MIT — built as a real-world solar engineering and off-grid survival tool.
