<script>
  import ClinometerGauge from '$lib/components/ClinometerGauge.svelte';
  import { app, can, openModal, toast, haptic } from '$lib/state/app.svelte.js';
  import { optimalTilt, cellTemperature, pvPower, GAMMA_PMAX_SILICON } from '$lib/solar/kernel.js';
  import { sunNow } from '$lib/state/app.svelte.js';
  import { MOUNTS, PANEL_COLORS } from '$lib/data/sites.js';

  const modes = [
    { id: 'today', label: 'Today only', hint: 'lat − δ (follows the declination)' },
    { id: 'fixed', label: 'Fixed year-round', hint: '|lat| × 0.87 compromise' },
    { id: 'winter', label: 'Winter max boost', hint: 'lat + 15° for low sun' },
    { id: 'summer', label: 'Summer max boost', hint: 'lat − 15° for high sun' }
  ];

  const sun = $derived(sunNow());
  const target = $derived(optimalTilt(app.latitude, app.dayOfYear, app.tiltMode));
  const thermalUnlocked = $derived(can('thermal'));

  /* --------------------------------------------------- live sensor fusion */
  let sensorActive = $state(false);
  let sensorNote = $state('Simulator dials — drag the tilt slider or connect the Kotlin bridge');

  async function enableSensors() {
    /** @type {any} */
    const DOE = window.DeviceOrientationEvent;
    try {
      if (DOE?.requestPermission) {
        const res = await DOE.requestPermission();
        if (res !== 'granted') throw new Error('denied');
      }
      window.addEventListener('deviceorientationabsolute', handleOrientation, true);
      window.addEventListener('deviceorientation', handleOrientation, true);
      sensorActive = true;
      app.permissions.orientation = true;
      app.permissionStatus.orientation = 'WEB ACTIVE';
      app.sensorSource = 'WEB ACTIVE';
      sensorNote = 'Live clinometer + magnetometer streaming';
      toast('3-axis clinometer online', 'success');
    } catch {
      app.permissionStatus.orientation = 'SIMULATOR ACTIVE';
      toast('Sensor permission denied — simulator active', 'warn');
    }
  }

  let smoothing = 30;
  /** @param {any} e */
  function handleOrientation(e) {
    // beta = front-back tilt (-180..180); in landscape the phone lies against the panel
    if (typeof e.beta !== 'number') return;
    const tilt = Math.max(0, Math.min(90, Math.abs(90 - Math.abs(e.beta))));
    smoothing = smoothing * 0.82 + tilt * 0.18;
    app.panel.tilt = +smoothing.toFixed(1);
    const compass = e.webkitCompassHeading ?? (typeof e.alpha === 'number' ? (360 - e.alpha) % 360 : null);
    if (compass !== null) app.panel.azimuth = Math.round(compass);
  }

  /* ------------------------------------------------- thermal derating lab */
  const mount = $derived(MOUNTS.find((m) => m.id === app.panel.mount) ?? MOUNTS[0]);
  const panelColor = $derived(PANEL_COLORS.find((c) => c.id === app.panel.color) ?? PANEL_COLORS[0]);
  const poa = $derived.by(() => {
    const am = 1 / (Math.sin((sun.elevation * Math.PI) / 180) + 0.50572 * Math.pow(sun.elevation + 6.07995, -1.6364));
    if (sun.elevation <= 0.5) return 0;
    const dni = 1367 * Math.pow(0.7, Math.pow(am, 0.678));
    return Math.max(0, dni * Math.cos(((90 - sun.elevation) * Math.PI) / 180));
  });

  const tCell = $derived(
    cellTemperature(app.ambientC * (0.94 + panelColor.absorptivity * 0.08), poa || 800, app.windMs, app.panel.mount)
  );
  const derate = $derived(pvPower(app.panel.kw, poa || 850, tCell, { gammaPctPerC: app.gamma }));
  const wattLoss = $derived(derate.thermalLossKw * 1000);

  const ambientF = $derived((app.ambientC * 9) / 5 + 32);

  /** @param {number} delta */
  function nudge(delta) {
    app.panel.tilt = Math.max(0, Math.min(90, +(app.panel.tilt + delta).toFixed(1)));
    haptic([8]);
  }
</script>

<div class="module">
  <section class="module-head">
    <div>
      <p class="eyebrow">Module 02 · Live Pitch/Azimuth Alignment</p>
      <h1 class="display" style="font-size: clamp(1.5rem, 3.6vw, 2.2rem); margin-top:.2rem;">
        Panel Tilt <span class="gradient-text">Clinometer</span>
      </h1>
      <p class="small muted" style="margin-top:.3rem; max-width:62ch;">
        Rest the phone against the panel edge (or use the desktop simulator) and dial the exact
        degrees for your latitude and season. Lock-on chimes and vibrates within ±0.5°.
      </p>
    </div>
    <button class="btn primary tiny" onclick={enableSensors}>
      {sensorActive ? '● Sensors streaming' : '◉ Connect clinometer'}
    </button>
  </section>

  <div class="clin-grid">
    <ClinometerGauge target={target} live={app.panel.tilt} azimuth={app.panel.azimuth} />

    <div class="glass tall">
      <p class="eyebrow">Alignment mode</p>
      <div class="mode-list">
        {#each modes as m}
          <button class="mode-row" class:sel={app.tiltMode === m.id} onclick={() => (app.tiltMode = m.id)}>
            <span class="col">
              <strong class="small">{m.label}</strong>
              <span class="tiny-text faint">{m.hint}</span>
            </span>
            <span class="mono numeral mode-val">{optimalTilt(app.latitude, app.dayOfYear, m.id).toFixed(1)}°</span>
          </button>
        {/each}
      </div>

      <div class="divider"></div>

      <div class="field">
        <label for="azimuth">Panel azimuth (0° N · 180° S)</label>
        <div class="row">
          <input id="azimuth" type="range" min="0" max="359" step="1" bind:value={app.panel.azimuth} />
          <span class="mono tiny-text nowrap">{app.panel.azimuth}°</span>
        </div>
      </div>

      <div class="nudge-row">
        <button class="btn ghost tiny" onclick={() => nudge(-5)}>−5°</button>
        <button class="btn ghost tiny" onclick={() => nudge(-1)}>−1°</button>
        <button class="btn ghost tiny" onclick={() => nudge(-0.5)}>−0.5°</button>
        <button class="btn ghost tiny" onclick={() => nudge(0.5)}>+0.5°</button>
        <button class="btn ghost tiny" onclick={() => nudge(1)}>+1°</button>
        <button class="btn ghost tiny" onclick={() => nudge(5)}>+5°</button>
      </div>

      <p class="tiny-text faint" style="margin-top:.5rem;">{sensorNote}</p>
    </div>
  </div>

  <!-- ================================================== thermal derating lab -->
  <section class="thermal glass tall" class:locked={!thermalUnlocked}>
    <div class="row between" style="flex-wrap:wrap; gap:.4rem;">
      <div>
        <p class="eyebrow" style="color: var(--coral)">Pro / Admin · Thermal Coefficient Cell Derating</p>
        <h3 style="font-size:1.02rem; margin-top:.1rem;">
          Real silicon loses power in the heat — γ = {app.gamma}%/°C
        </h3>
      </div>
      {#if !thermalUnlocked}
        <button class="btn primary tiny" onclick={() => openModal('privileges')}>Unlock Pro tier</button>
      {:else}
        <span class="chip critical">γ {app.gamma}%/°C silicon</span>
      {/if}
    </div>

    {#if thermalUnlocked}
      <div class="thermal-grid">
        <div class="thermal-controls">
          <label class="field">
            <span>Ambient temperature</span>
            <div class="row">
              <input type="range" min="-25" max="55" step="0.5" bind:value={app.ambientC} />
              <span class="mono tiny-text nowrap">{app.ambientC.toFixed(1)}°C</span>
            </div>
            <span class="tiny-text faint">{ambientF.toFixed(1)} °F air temp</span>
          </label>

          <label class="field">
            <span>Wind cooling</span>
            <div class="row">
              <input type="range" min="0" max="12" step="0.2" bind:value={app.windMs} />
              <span class="mono tiny-text nowrap">{app.windMs.toFixed(1)} m/s</span>
            </div>
            <span class="tiny-text faint">{app.windMs < 1 ? 'Still air — worst case heat soak' : app.windMs < 4 ? 'Light breeze' : 'Strong convective cooling'}</span>
          </label>

          <label class="field">
            <span>Mounting gap</span>
            <select bind:value={app.panel.mount}>
              {#each MOUNTS as m}<option value={m.id}>{m.name} — {m.note}</option>{/each}
            </select>
            <span class="tiny-text faint">Heat factor ×{mount.factor}</span>
          </label>

          <label class="field">
            <span>Panel backsheet</span>
            <select bind:value={app.panel.color}>
              {#each PANEL_COLORS as c}<option value={c.id}>{c.name}</option>{/each}
            </select>
          </label>

          <label class="field">
            <span>Temperature coefficient γ (%/°C)</span>
            <div class="row">
              <input type="range" min="-0.5" max="-0.24" step="0.01" bind:value={app.gamma} />
              <span class="mono tiny-text nowrap">{app.gamma}</span>
            </div>
            <span class="tiny-text faint">−0.35 typical mono-PERC · −0.24 HJT · −0.38 conservative</span>
          </label>
        </div>

        <div class="thermal-results">
          <div class="tcell">
            <p class="stat-label">Cell operating temperature</p>
            <p class="numeral display" style="font-size:2.35rem; color: var(--coral)">{tCell.toFixed(1)}°C</p>
            <p class="tiny-text faint">{((tCell * 9) / 5 + 32).toFixed(0)} °F · NOCT model + wind + mount</p>
            <div class="heat-bar">
              <span style="width: {Math.min(100, Math.max(0, ((tCell - 20) / 60) * 100))}%"></span>
            </div>
          </div>

          <div class="grid cols-2" style="gap:.5rem;">
            <div class="mini">
              <p class="stat-label">Power factor</p>
              <p class="numeral stat-value">{(derate.temperatureFactor * 100).toFixed(1)}%</p>
              <p class="tiny-text faint">of STC rating</p>
            </div>
            <div class="mini">
              <p class="stat-label">Watts lost</p>
              <p class="numeral stat-value" style="color: var(--magenta)">−{wattLoss.toFixed(0)} W</p>
              <p class="tiny-text faint">of {app.panel.kw} kW array</p>
            </div>
            <div class="mini">
              <p class="stat-label">Actual output</p>
              <p class="numeral stat-value" style="color: var(--emerald)">{(derate.dcKw * 1000).toFixed(0)} W</p>
              <p class="tiny-text faint">DC at {poa.toFixed(0)} W/m²</p>
            </div>
            <div class="mini">
              <p class="stat-label">Annual heat loss</p>
              <p class="numeral stat-value">{(((1 - derate.temperatureFactor) * 100) * 13).toFixed(0)}</p>
              <p class="tiny-text faint">≈kWh/yr on this array</p>
            </div>
          </div>

          <div class="insight">
            <span class="dot" style="color: var(--gold)"></span>
            <p class="tiny-text">
              {#if tCell > 60}
                Panels are cooking at <strong>{tCell.toFixed(0)}°C</strong>. Add a 10 cm standoff gap or
                white backsheet to recover ≈{(wattLoss * 0.28).toFixed(0)} W of the {wattLoss.toFixed(0)} W lost.
              {:else if tCell > 45}
                Normal hot-roof derating. Surface airflow is your cheapest efficiency upgrade.
              {:else}
                Cool cells — running close to STC. This is near-ideal operating temperature.
              {/if}
            </p>
          </div>
        </div>
      </div>
    {:else}
      <p class="small muted" style="margin-top:.6rem;">
        The thermal derating simulator, horizon shade editor, quote audit and MPPT string sizer are
        Pro-tier capabilities. Switch tier in the header to explore them.
      </p>
    {/if}
  </section>
</div>

<style>
  .module {
    padding-block: 0.6rem 1.4rem;
    display: grid;
    gap: 1rem;
  }

  .module-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .clin-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(280px, 0.85fr);
    gap: 1rem;
    align-items: start;
  }

  .mode-list {
    display: grid;
    gap: 0.26rem;
    margin-top: 0.5rem;
  }

  .mode-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    padding: 0.46rem 0.6rem;
    border-radius: 11px;
    border: 1px solid transparent;
    text-align: left;
    transition: all 200ms ease;
  }

  .mode-row:hover {
    background: color-mix(in oklab, var(--surface-hi) 60%, transparent);
  }

  .mode-row.sel {
    background: color-mix(in oklab, var(--gold) 13%, transparent);
    border-color: color-mix(in oklab, var(--gold) 38%, transparent);
  }

  .mode-val {
    font-size: 0.92rem;
    font-weight: 700;
    color: var(--emerald);
  }

  .col {
    display: grid;
    gap: 0.06rem;
    min-width: 0;
  }

  .nudge-row {
    display: flex;
    gap: 0.3rem;
    flex-wrap: wrap;
    margin-top: 0.5rem;
  }

  .thermal.locked {
    opacity: 0.94;
  }

  .thermal-grid {
    display: grid;
    grid-template-columns: minmax(260px, 0.9fr) minmax(0, 1.1fr);
    gap: 1rem;
    margin-top: 0.7rem;
  }

  .thermal-controls {
    display: grid;
    gap: 0.6rem;
  }

  .thermal-results {
    display: grid;
    gap: 0.55rem;
    align-content: start;
  }

  .tcell {
    padding: 0.7rem 0.85rem;
    border-radius: 16px;
    background: linear-gradient(140deg, rgba(249, 115, 22, 0.16), rgba(236, 72, 153, 0.09));
    border: 1px solid color-mix(in oklab, var(--coral) 34%, transparent);
  }

  .heat-bar {
    height: 6px;
    margin-top: 0.5rem;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.36);
    overflow: hidden;
  }

  .heat-bar span {
    display: block;
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, #22D3EE, #F59E0B 55%, #EC4899);
    box-shadow: 0 0 14px rgba(249, 115, 22, 0.7);
    transition: width 420ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .mini {
    padding: 0.5rem 0.6rem;
    border-radius: 12px;
    background: color-mix(in oklab, var(--surface-solid) 46%, transparent);
    border: 1px solid var(--border);
  }

  .mini .stat-value {
    font-size: 1.2rem;
  }

  .insight {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    padding: 0.55rem 0.7rem;
    border-radius: 12px;
    background: color-mix(in oklab, var(--gold) 9%, transparent);
    border: 1px solid color-mix(in oklab, var(--gold) 26%, transparent);
  }

  .insight .dot {
    margin-top: 0.25rem;
  }

  @media (max-width: 1000px) {
    .clin-grid,
    .thermal-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
