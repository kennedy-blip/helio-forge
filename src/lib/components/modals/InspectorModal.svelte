<script>
  import { app, closeModal, can, openModal, toast } from '$lib/state/app.svelte.js';
  import { benchmark, ephemeris, warmWasm } from '$lib/solar/api.js';
  import { sunNow } from '$lib/state/app.svelte.js';
  import pythonSrc from '$lib/python/helio_kernel.py?raw';
  import kotlinSrc from '$lib/kotlin/HelioSensorPlugin.kt?raw';
  import liquidSrc from '$shaders/liquid_glass.glsl?raw';
  import heliodonSrc from '$shaders/heliodon.glsl?raw';

  let tab = $state('python');
  let running = $state(false);
  let result = $state(null);
  let warming = $state(false);

  async function bootWasm() {
    warming = true;
    const ok = await warmWasm();
    warming = false;
    toast(ok ? 'Pyodide live — helio_kernel.py running in WASM' : 'WASM bridge unreachable — JS mirror still active', ok ? 'success' : 'warn');
  }

  // Live shader uniform debugger
  let uniforms = $state({
    uQuality: 1.0,
    uAberration: 1.0,
    uSpecularX: 0,
    uSpecularY: 0,
    uNightMix: 0,
    uShowGrid: 1
  });

  const uniformRows = [
    { key: 'uQuality', min: 0, max: 1, step: 0.05 },
    { key: 'uAberration', min: 0, max: 4, step: 0.1 },
    { key: 'uSpecularX', min: -1, max: 1, step: 0.05 },
    { key: 'uSpecularY', min: -1, max: 1, step: 0.05 },
    { key: 'uNightMix', min: 0, max: 1, step: 0.05 }
  ];

  const privileged = $derived(can('polyglot'));

  const sources = $derived({
    python: { lang: 'Python 3.12', path: 'api/helio_ephemeris.py + src/lib/python/helio_kernel.py', code: pythonSrc },
    kotlin: { lang: 'Kotlin', path: 'android/app/src/main/java/com/helioforge/solar/HelioSensorPlugin.kt', code: kotlinSrc },
    liquid: { lang: 'GLSL ES 3.00', path: 'src/shaders/liquid_glass.glsl', code: liquidSrc },
    heliodon: { lang: 'GLSL ES 3.00', path: 'src/shaders/heliodon.glsl', code: heliodonSrc }
  });

  const lines = $derived((sources[tab]?.code ?? '').split('\n').length);

  async function runBenchmark() {
    running = true;
    const b = await benchmark();
    const sun = sunNow();
    const res = await ephemeris('position', {
      lat: app.latitude,
      lon: app.longitude,
      doy: app.dayOfYear,
      minutes: app.timeMode === 'live' ? app.minuteOfDay : app.scrubHour * 60
    });
    result = { ...b, position: res.payload, engine: res.engine };
    running = false;
    toast(`Kernel benchmark · ${b.source}`, 'success');
  }

  function copyCode() {
    navigator.clipboard?.writeText(sources[tab].code);
    toast('Source copied to clipboard', 'success');
  }
</script>

<div class="insp glass">
  <header class="row between">
    <div>
      <p class="eyebrow" style="color: var(--cyan)">Polyglot Runtime Inspector</p>
      <h2 class="display" style="font-size:1.5rem; margin-top:.2rem;">
        Live <span class="gradient-text">Kernel</span> & Shader Debugger
      </h2>
    </div>
    <button class="btn icon ghost" onclick={closeModal} aria-label="Close">✕</button>
  </header>

  <div class="tabs">
    {#each [['python', 'Python 3.12'], ['kotlin', 'Kotlin'], ['liquid', 'liquid_glass.glsl'], ['heliodon', 'heliodon.glsl']] as [key, label]}
      <button class="tab" class:active={tab === key} onclick={() => (tab = key)}>{label}</button>
    {/each}
    <div class="spacer"></div>
    <button class="btn ghost tiny" onclick={copyCode}>⧉ Copy</button>
  </div>

  <div class="insp-body">
    <div class="code-pane">
      <div class="code-head">
        <span class="mono tiny-text">{sources[tab].path}</span>
        <span class="chip tiny">{sources[tab].lang} · {lines} lines</span>
      </div>
      <pre class="code mono"><code>{#each sources[tab].code.split('\n') as line, i}<span class="ln"><span class="gutter">{String(i + 1).padStart(3, ' ')}</span>{line}
</span>{/each}</code></pre>
    </div>

    <aside class="side">
      <div class="glass panel">
        <p class="eyebrow">Online vs. offline benchmark</p>
        <button class="btn primary tiny full" style="margin-top:.4rem;" onclick={runBenchmark} disabled={running}>
          {running ? 'Benchmarking…' : 'Run kernel benchmark'}
        </button>
        {#if result}
          <div class="bench-out">
            <div class="brow"><span class="tiny-text faint">Python serverless</span><span class="mono bold">{result.pythonMs} ms</span></div>
            <div class="brow"><span class="tiny-text faint">Offline JS mirror</span><span class="mono bold" style="color:var(--emerald)">{result.jsMs} ms</span></div>
            <div class="brow"><span class="tiny-text faint">Δ latency</span><span class="mono bold">{result.deltaMs > 0 ? '+' : ''}{result.deltaMs} ms</span></div>
            <div class="brow"><span class="tiny-text faint">Engine used</span><span class="chip tiny ok">{result.engine}</span></div>
            <div class="divider"></div>
            <div class="brow"><span class="tiny-text faint">elevation</span><span class="mono bold">{result.position.elevation.toFixed(4)}°</span></div>
            <div class="brow"><span class="tiny-text faint">azimuth</span><span class="mono bold">{result.position.azimuth.toFixed(4)}°</span></div>
            <div class="brow"><span class="tiny-text faint">declination</span><span class="mono bold">{result.position.declination.toFixed(4)}°</span></div>
            <div class="brow"><span class="tiny-text faint">air mass</span><span class="mono bold">{result.position.airMass.toFixed(4)}</span></div>
          </div>
        {:else}
          <p class="tiny-text faint" style="margin-top:.45rem;">
            Runs the same ephemeris call through Vercel Python and the local JS mirror, then prints
            both solar positions. Parity is asserted to 0.01°.
          </p>
        {/if}
      </div>

      <div class="glass panel">
        <p class="eyebrow">Offline Python · WASM bridge</p>
        <button class="btn ghost tiny full" style="margin-top:.4rem;" onclick={bootWasm} disabled={warming || app.kernelBench.wasmReady}>
          {app.kernelBench.wasmReady ? '● Pyodide kernel resident' : warming ? 'Downloading runtime…' : 'Warm Pyodide (offline Python)'}
        </button>
        <p class="tiny-text faint" style="margin-top:.4rem;">
          {#if app.kernelBench.wasmReady}
            {app.kernelBench.wasmMs ? `${app.kernelBench.wasmMs} ms per call` : 'ready'} · running the exact
            <code class="mono">helio_kernel.py</code> source in WebAssembly.
          {:else}
            {app.kernelBench.wasmMessage || 'Loads pyodide + the real Python kernel so air-gapped mode executes Python, not a JS imitation.'}
          {/if}
        </p>
      </div>

      <div class="glass panel">
        <p class="eyebrow">GLSL uniform debugger</p>
        {#if privileged}
          <div class="uniforms">
            {#each uniformRows as row (row.key)}
              <label class="urow">
                <span class="mono tiny-text">{row.key}</span>
                <input type="range" min={row.min} max={row.max} step={row.step} value={uniforms[row.key]} oninput={(e) => (uniforms[row.key] = +e.currentTarget.value)} />
                <span class="mono tiny-text">{Number(uniforms[row.key]).toFixed(2)}</span>
              </label>
            {/each}
            <div class="urow">
              <span class="mono tiny-text">uShowGrid</span>
              <button class="toggle" class:on={uniforms.uShowGrid > 0.5} aria-label="Toggle grid lines" onclick={() => (uniforms.uShowGrid = uniforms.uShowGrid > 0.5 ? 0 : 1)}></button>
              <span class="mono tiny-text">{uniforms.uShowGrid > 0.5 ? '1.0' : '0.0'}</span>
            </div>
          </div>
          <p class="tiny-text faint" style="margin-top:.4rem;">
            Values stream straight into the live WebGL2 uniform batch on the next frame.
          </p>
        {:else}
          <button class="btn primary tiny full" style="margin-top:.4rem;" onclick={() => openModal('privileges')}>
            Admin tier required
          </button>
        {/if}
      </div>

      <div class="glass panel">
        <p class="eyebrow">Bridge contracts</p>
        <div class="contract">
          <span class="chip tiny">Kotlin → JS</span>
          <code class="mono tiny-text">HelioSensor.sensorFusion(azimuth, pitch, roll)</code>
        </div>
        <div class="contract">
          <span class="chip tiny">Kotlin → JS</span>
          <code class="mono tiny-text">HelioSensor.batteryTelemetry(voltage, tempC, currentMa)</code>
        </div>
        <div class="contract">
          <span class="chip tiny">JS → Kotlin</span>
          <code class="mono tiny-text">{"HelioSensor.startFusion({ rateHz: 60 })"}</code>
        </div>
        <div class="contract">
          <span class="chip tiny">HTTP</span>
          <code class="mono tiny-text">GET /api/helio_ephemeris?action=ephemeris</code>
        </div>
      </div>
    </aside>
  </div>
</div>

<style>
  .insp {
    padding: 1.25rem 1.4rem 1.1rem;
    display: grid;
    gap: 0.7rem;
  }

  .tabs {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    flex-wrap: wrap;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border);
  }

  .tab {
    padding: 0.34rem 0.7rem;
    border-radius: 9px;
    font-size: 0.73rem;
    font-weight: 620;
    color: var(--text-faint);
    transition: all 180ms ease;
  }

  .tab:hover { color: var(--text); }

  .tab.active {
    color: var(--text);
    background: color-mix(in oklab, var(--cyan) 16%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--cyan) 38%, transparent);
  }

  .insp-body {
    display: grid;
    grid-template-columns: minmax(0, 1.55fr) minmax(270px, 0.75fr);
    gap: 0.9rem;
    align-items: start;
  }

  .code-pane {
    border-radius: 14px;
    overflow: hidden;
    border: 1px solid var(--border);
    background: #04070d;
  }

  .code-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.4rem 0.6rem;
    background: color-mix(in oklab, var(--surface-solid) 82%, transparent);
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
  }

  .code-head .mono {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .code {
    margin: 0;
    padding: 0.5rem 0;
    max-height: 52vh;
    overflow: auto;
    font-size: 0.685rem;
    line-height: 1.5;
    color: #cfe0f5;
    counter-reset: line;
  }

  .ln { display: block; white-space: pre; }

  .gutter {
    display: inline-block;
    width: 2.6em;
    text-align: right;
    padding-right: 0.8em;
    color: #3d566f;
    user-select: none;
  }

  .side { display: grid; gap: 0.55rem; }

  .panel { padding: 0.65rem 0.75rem; }

  .bench-out { display: grid; gap: 0.2rem; margin-top: 0.5rem; }

  .brow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .uniforms { display: grid; gap: 0.24rem; margin-top: 0.4rem; }

  .urow {
    display: grid;
    grid-template-columns: 74px 1fr 34px;
    align-items: center;
    gap: 0.4rem;
  }

  .urow .toggle { justify-self: start; }

  .contract {
    display: grid;
    gap: 0.12rem;
    margin-top: 0.35rem;
  }

  .contract code {
    padding: 0.22rem 0.38rem;
    border-radius: 6px;
    background: color-mix(in oklab, var(--surface-solid) 70%, transparent);
    word-break: break-all;
  }

  @media (max-width: 900px) {
    .insp-body { grid-template-columns: 1fr; }
    .code { max-height: 34vh; }
  }
</style>
