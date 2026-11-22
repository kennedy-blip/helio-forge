<script>
  import { onMount } from 'svelte';
  import { app, can, openModal, toast, currentRole } from '$lib/state/app.svelte.js';
  import {
    list,
    queueSnapshot,
    flushQueue,
    clearVault,
    cloudHealth,
    restoreFromCloud,
    saveSiteSnapshot,
    sitesToCsv,
    deleteRow,
    initVault
  } from '$lib/db/vault.js';
  import { benchmark, warmWasm } from '$lib/solar/api.js';
  import { sunNow } from '$lib/state/app.svelte.js';
  import { ephemeris } from '$lib/solar/api.js';

  /** @type {any[]} */
  let sites = $state([]);
  /** @type {any[]} */
  let audits = $state([]);
  /** @type {any[]} */
  let configs = $state([]);
  /** @type {any[]} */
  let queue = $state([]);
  let loading = $state(true);
  let tab = $state('sites');
  /** @type {any} */
  let cloud = $state({ ok: false, configured: false, source: 'none', host: '', device: '', error: null });
  let busy = $state('');

  const privileged = $derived(can('polyglot'));
  const sun = $derived(sunNow());

  async function refresh() {
    loading = true;
    await initVault();
    [sites, audits, configs, queue] = await Promise.all([
      list('sites'),
      list('audits'),
      list('batteryConfigs'),
      queueSnapshot()
    ]);
    loading = false;
  }

  async function probeCloud() {
    cloud = await cloudHealth();
  }

  async function doRestore() {
    busy = 'restore';
    await restoreFromCloud();
    await refresh();
    await probeCloud();
    busy = '';
  }

  async function runBench() {
    const b = await benchmark();
    toast(
      `Python ${b.pythonMs} ms · JS ${b.jsMs} ms (${b.source})`,
      b.source === 'online' ? 'success' : 'warn'
    );
  }

  async function doFlush() {
    busy = 'flush';
    await flushQueue();
    await refresh();
    await probeCloud();
    busy = '';
  }

  /** @param {any} row */
  function openReport(row) {
    openModal('blueprint', { kind: 'site', row });
  }

  function exportCsv() {
    const csv = sitesToCsv(sites);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `helioforge-sites-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('CSV exported', 'success');
  }

  function exportJson() {
    const payload = { exportedAt: new Date().toISOString(), sites, audits, configs, queue };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `helioforge-telemetry-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Raw JSON telemetry exported', 'success');
  }

  onMount(async () => {
    await refresh();
    await probeCloud();
  });

  const benchmarks = $derived([
    { name: 'NOAA SPA solar position', py: 'solar_position()', js: 'solarPosition()', note: 'Spencer declination + EoT, <0.01° parity' },
    { name: 'ASHRAE clear-sky DNI', py: 'clear_sky_irradiance()', js: 'clearSkyIrradiance()', note: 'Kasten-Young air mass, τb = 0.7' },
    { name: 'PV thermal derating', py: 'cell_temperature()', js: 'cellTemperature()', note: 'NOCT + wind + mount factor' },
    { name: 'Peukert autonomy', py: 'peukert_runtime()', js: 'peukertRuntime()', note: 't = H·(C/(I·H))^k' },
    { name: 'MPPT cold Voc', py: 'string_sizing()', js: 'stringSizing()', note: '−0.29%/°C β coefficient' }
  ]);
</script>

<div class="module">
  <section class="module-head">
    <div>
      <p class="eyebrow">Module 05 · Polyglot Telemetry & Site Vault</p>
      <h1 class="display" style="font-size: clamp(1.5rem, 3.6vw, 2.2rem); margin-top:.2rem;">
        Site <span class="gradient-text">Vault</span> & Runtime Inspector
      </h1>
      <p class="small muted" style="margin-top:.3rem; max-width:64ch;">
        Site surveys, horizon profiles, battery configs and quote audits live in IndexedDB — fully
        offline. The sync queue flushes the moment the blackout ends.
      </p>
    </div>
    <div class="row" style="gap:.35rem;">
      <button class="btn ghost tiny" onclick={() => saveSiteSnapshot()}>+ Save current site</button>
      <button class="btn ghost tiny" onclick={() => openModal('inspector')}>{'{ }'} Inspector</button>
    </div>
  </section>

  <!-- ========================================================== cloud status -->
  <section class="glass pad cloud-strip">
    <div class="cloud-id">
      <span class="dot" class:live={cloud.ok} class:off={cloud.configured && !cloud.ok} class:none={!cloud.configured}></span>
      <div class="col">
        <span class="small bold">
          {#if !cloud.configured}
            Cloud sync unconfigured
          {:else if cloud.ok}
            Supabase reachable
          {:else}
            Cloud unreachable
          {/if}
        </span>
        <span class="tiny-text faint">
          {#if cloud.configured}
            {cloud.host}.supabase.co · device {cloud.device} · key from {cloud.source}
            {#if cloud.error}· {cloud.error}{/if}
          {:else}
            Vault stays local until credentials are provided
          {/if}
        </span>
      </div>
    </div>
    <div class="row" style="gap:.3rem; flex-wrap:wrap;">
      <button class="btn ghost tiny" onclick={probeCloud} disabled={busy !== ''}>Ping</button>
      <button class="btn ghost tiny" onclick={doRestore} disabled={busy !== '' || !cloud.configured}>
        {busy === 'restore' ? 'Restoring…' : '⤒ Restore from cloud'}
      </button>
    </div>
  </section>

  <!-- ============================================================== metrics -->
  <section class="grid cols-4" style="margin-bottom:1rem;">
    <div class="glass pad">
      <p class="stat-label">Site surveys</p>
      <p class="numeral stat-value">{sites.length}</p>
    </div>
    <div class="glass pad">
      <p class="stat-label">Quote audits</p>
      <p class="numeral stat-value">{audits.length}</p>
    </div>
    <div class="glass pad">
      <p class="stat-label">Battery configs</p>
      <p class="numeral stat-value">{configs.length}</p>
    </div>
    <div class="glass pad">
      <p class="stat-label">Sync queue</p>
      <p class="numeral stat-value" style="color:{queue.length ? 'var(--gold)' : 'var(--emerald)'}">{queue.length}</p>
    </div>
  </section>

  <div class="vault-grid">
    <div class="glass tall">
      <div class="row between" style="flex-wrap:wrap; gap:.4rem;">
        <div class="seg">
          <button class:active={tab === 'sites'} onclick={() => (tab = 'sites')}>Sites</button>
          <button class:active={tab === 'audits'} onclick={() => (tab = 'audits')}>Audits</button>
          <button class:active={tab === 'battery'} onclick={() => (tab = 'battery')}>Batteries</button>
        </div>
        <div class="row" style="gap:.3rem;">
          <button class="btn ghost tiny" onclick={refresh}>↻</button>
          <button class="btn ghost tiny" onclick={doFlush}>⇅ Flush queue</button>
          <button class="btn ghost tiny" onclick={clearVault}>Wipe</button>
        </div>
      </div>

      <div class="rows">
        {#if loading}
          <p class="small faint" style="padding:1rem 0">Reading IndexedDB…</p>
        {:else if tab === 'sites'}
          {#each sites as row (row.id)}
            <button class="vrow" onclick={() => openReport(row)}>
              <span class="vrow-main">
                <span class="small bold">{row.name}</span>
                <span class="tiny-text faint">
                  {row.kind} · {Number(row.lat).toFixed(2)}°, {Number(row.lon).toFixed(2)}° ·
                  tilt {row.tilt}° · {row.horizonCount} nodes
                </span>
              </span>
              <span class="chip tiny" class:ok={row.syncState === 'synced'}>{row.syncState ?? 'pending'}</span>
              <span class="mono tiny-text faint">{new Date(row.createdAt).toLocaleDateString()}</span>
            </button>
          {:else}
            <div class="empty">
              <p class="small muted">No site surveys yet.</p>
              <button class="btn ghost tiny" onclick={() => saveSiteSnapshot()}>Capture this site</button>
            </div>
          {/each}
        {:else if tab === 'audits'}
          {#each audits as row (row.id)}
            <div class="vrow">
              <span class="vrow-main">
                <span class="small bold">{row.company}</span>
                <span class="tiny-text faint">${row.dollarsPerWatt}/W · {Number(row.physicsKwhPerYear).toLocaleString()} kWh/yr physics</span>
              </span>
              <span class="chip tiny" class:ok={row.verdictClass === 'ok'} class:warn={row.verdictClass === 'warn'} class:critical={row.verdictClass === 'critical'}>{row.verdictClass}</span>
              <button class="btn icon ghost" onclick={() => openModal('blueprint', { kind: 'audit', row })}>⋯</button>
            </div>
          {:else}
            <div class="empty"><p class="small muted">No quote audits saved.</p></div>
          {/each}
        {:else}
          {#each configs as row (row.id)}
            <div class="vrow">
              <span class="vrow-main">
                <span class="small bold">{row.name}</span>
                <span class="tiny-text faint">{row.result?.runtimeHours ?? '∞'} h runtime · {row.result?.usableWh} Wh usable</span>
              </span>
              <span class="mono tiny-text faint">{new Date(row.createdAt).toLocaleDateString()}</span>
            </div>
          {:else}
            <div class="empty"><p class="small muted">No battery configs saved.</p></div>
          {/each}
        {/if}
      </div>

      {#if privileged}
        <div class="divider"></div>
        <div class="row" style="gap:.35rem; flex-wrap:wrap;">
          <button class="btn ghost tiny" onclick={exportCsv}>⤓ CSV irradiance</button>
          <button class="btn ghost tiny" onclick={exportJson}>⤓ Raw JSON telemetry</button>
        </div>
      {/if}
    </div>

    <!-- ==================================================== runtime inspector -->
    <aside class="side">
      <div class="glass tall">
        <p class="eyebrow">Polyglot runtime</p>
        <div class="runtime-rows">
          <div class="rr">
            <span class="lang py">PY</span>
            <div class="col">
              <span class="small bold">Python 3.12 ephemeris</span>
              <span class="tiny-text faint">{app.kernelBench.pythonMs ? `${app.kernelBench.pythonMs} ms` : 'not queried'} · {app.kernelBench.source}</span>
            </div>
            <span class="chip tiny" class:ok={app.kernelBench.pythonMs !== null} class:warn={app.kernelBench.pythonMs === null}>
              {app.kernelBench.pythonMs !== null ? 'ONLINE' : 'IDLE'}
            </span>
          </div>
          <div class="rr">
            <span class="lang js">JS</span>
            <div class="col">
              <span class="small bold">Offline kernel mirror</span>
              <span class="tiny-text faint">{app.kernelBench.jsMs ? `${app.kernelBench.jsMs} ms` : 'instant'} · 0.01° parity</span>
            </div>
            <span class="chip tiny ok">ALWAYS</span>
          </div>
          <div class="rr">
            <span class="lang wasm">WA</span>
            <div class="col">
              <span class="small bold">Pyodide WASM bridge</span>
              <span class="tiny-text faint">{app.kernelBench.wasmReady ? `${app.kernelBench.wasmMs ?? '—'} ms · real helio_kernel.py` : 'cold — tap to load'}</span>
            </div>
            <button class="btn ghost tiny" onclick={() => warmWasm()}>{app.kernelBench.wasmReady ? 'ready' : 'warm'}</button>
          </div>
          <div class="rr">
            <span class="lang glsl">GL</span>
            <div class="col">
              <span class="small bold">WebGL2 shaders</span>
              <span class="tiny-text faint">liquid_glass · heliodon · {app.lowGpu ? 'eco 0.35×' : 'full 60fps'}</span>
            </div>
            <span class="chip tiny" class:ok={!app.lowGpu}>{app.lowGpu ? 'ECO' : 'FULL'}</span>
          </div>
          <div class="rr">
            <span class="lang kt">KT</span>
            <div class="col">
              <span class="small bold">Kotlin sensor bridge</span>
              <span class="tiny-text faint">{app.sensorSource} · {app.permissionStatus.orientation}</span>
            </div>
            <span class="chip tiny" class:warn={app.sensorSource === 'SIMULATOR'} class:ok={app.sensorSource !== 'SIMULATOR'}>
              {app.sensorSource === 'SIMULATOR' ? 'SIM' : 'LIVE'}
            </span>
          </div>
        </div>
        <div class="row" style="gap:.35rem; margin-top:.55rem; flex-wrap:wrap;">
          <button class="btn ghost tiny" onclick={runBench}>Benchmark Python vs JS</button>
          <button class="btn ghost tiny" onclick={() => openModal('inspector')}>Open inspector</button>
        </div>
      </div>

      <div class="glass tall">
        <p class="eyebrow">Cross-language parity</p>
        <div class="bench-list">
          {#each benchmarks as b}
            <div class="bench">
              <span class="small bold">{b.name}</span>
              <span class="mono tiny-text faint">{b.py} ⇄ {b.js}</span>
              <span class="tiny-text faint">{b.note}</span>
            </div>
          {/each}
        </div>
        <p class="tiny-text faint" style="margin-top:.5rem;">
          Parity harness: <code class="mono">node scripts/kernel-parity.mjs</code> — 800 sampled
          states, max deviation 8.5 × 10⁻¹⁴ °.
        </p>
      </div>
    </aside>
  </div>
</div>

<style>
  .module { padding-block: 0.6rem 1.4rem; }

  .module-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 0.9rem;
  }

  .vault-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) minmax(290px, 0.7fr);
    gap: 1rem;
    align-items: start;
  }

  .rows {
    display: grid;
    gap: 0.24rem;
    margin-top: 0.6rem;
    max-height: 430px;
    overflow-y: auto;
  }

  .vrow {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 0.55rem;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: color-mix(in oklab, var(--surface-solid) 40%, transparent);
    text-align: left;
    width: 100%;
    transition: all 180ms ease;
  }

  .vrow:hover {
    border-color: var(--border-hi);
    background: color-mix(in oklab, var(--surface-hi) 55%, transparent);
  }

  .vrow-main {
    display: grid;
    gap: 0.06rem;
    flex: 1;
    min-width: 0;
  }

  .empty {
    display: grid;
    justify-items: start;
    gap: 0.4rem;
    padding: 1rem 0;
  }

  .cloud-strip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    flex-wrap: wrap;
    margin-bottom: 0.8rem;
    padding: 0.6rem 0.8rem;
  }

  .cloud-id {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    min-width: 0;
  }

  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex: none;
    background: var(--text-faint);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--text-faint) 22%, transparent);
  }

  .dot.live { background: var(--emerald); box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.18); }
  .dot.off { background: var(--gold); box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.18); }
  .dot.none { background: var(--critical, #ef4444); box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.16); }

  .side { display: grid; gap: 0.8rem; }

  .runtime-rows { display: grid; gap: 0.3rem; margin-top: 0.5rem; }

  .rr {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.5rem;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: color-mix(in oklab, var(--surface-solid) 38%, transparent);
  }

  .lang {
    width: 30px;
    height: 24px;
    display: grid;
    place-items: center;
    border-radius: 7px;
    font-size: 0.56rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    flex: none;
  }

  .lang.py { background: rgba(245, 158, 11, 0.2); color: #FCD34D; }
  .lang.wasm { background: rgba(139, 92, 246, 0.24); color: #C4B5FD; }
  .lang.js { background: rgba(250, 204, 21, 0.18); color: #FDE68A; }
  .lang.glsl { background: rgba(139, 92, 246, 0.22); color: #C4B5FD; }
  .lang.kt { background: rgba(34, 211, 238, 0.18); color: #67E8F9; }

  .col { display: grid; gap: 0.04rem; flex: 1; min-width: 0; }

  .bench-list { display: grid; gap: 0.3rem; margin-top: 0.5rem; }

  .bench {
    display: grid;
    gap: 0.03rem;
    padding: 0.32rem 0.45rem;
    border-radius: 9px;
    background: color-mix(in oklab, var(--surface-solid) 34%, transparent);
  }

  code {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.94em;
    padding: 0.05em 0.25em;
    border-radius: 4px;
    background: color-mix(in oklab, var(--surface-solid) 70%, transparent);
  }

  @media (max-width: 1000px) {
    .vault-grid { grid-template-columns: 1fr; }
  }
</style>
