<script>
  import { app, can, openModal, toast } from '$lib/state/app.svelte.js';
  import HeliodonDome from '$lib/components/HeliodonDome.svelte';
  import ARCameraOverlay from '$lib/components/ARCameraOverlay.svelte';
  import TimeScrubber from '$lib/components/TimeScrubber.svelte';
  import HorizonEditor from '$lib/components/HorizonEditor.svelte';
  import { PRESET_SITES } from '$lib/data/sites.js';
  import { setSite, sunNow, optimalTiltNow } from '$lib/state/app.svelte.js';
  import { ephemerisPayload } from '$lib/solar/kernel.js';
  import { ephemeris } from '$lib/solar/api.js';
  import { saveSiteSnapshot } from '$lib/db/vault.js';
  import YearCurve from '$lib/components/YearCurve.svelte';

  const sun = $derived(sunNow());
  const tilts = $derived({
    today: optimalTiltNow('today'),
    fixed: optimalTiltNow('fixed'),
    winter: optimalTiltNow('winter'),
    summer: optimalTiltNow('summer')
  });

  const dayEnergy = $derived.by(() =>
    ephemerisPayload({
      latitude: app.latitude,
      longitude: app.longitude,
      doy: app.dayOfYear,
      tilt: app.panel.tilt,
      panelAzimuth: app.panel.azimuth,
      timezoneOffsetHours: app.timezoneOffset,
      horizon: app.horizon,
      kwStc: app.panel.kw
    })
  );

  async function pullPython() {
    const res = await ephemeris('ephemeris', {
      latitude: app.latitude,
      longitude: app.longitude,
      doy: app.dayOfYear,
      tilt: app.panel.tilt,
      panelAzimuth: app.panel.azimuth,
      timezoneOffsetHours: app.timezoneOffset,
      horizon: app.horizon,
      kwStc: app.panel.kw
    });
    toast(`${res.engine} · ${res.ms.toFixed(1)} ms · ${res.payload.energyKwh} kWh/day`, 'success');
  }
</script>

<div class="module">
  <!-- ================================================================ header -->
  <section class="module-head">
    <div>
      <p class="eyebrow">Module 01 · Optical AR Heliodon</p>
      <h1 class="display" style="font-size: clamp(1.5rem, 3.6vw, 2.2rem); margin-top:.2rem;">
        365-Day <span class="gradient-text">Solar Path</span> & Shade Scanner
      </h1>
      <p class="small muted" style="margin-top:.3rem; max-width:60ch;">
        Project the June-21, equinox and Dec-21 arcs over your live skyline, or orbit the WebGL2
        glass dome. Every photon number below is computed by the same NOAA/NREL kernel that the
        Python serverless function and the offline WASM bridge run.
      </p>
    </div>
    <div class="head-actions">
      <div class="seg">
        <button class:active={app.heliodonMode === 'dome'} onclick={() => (app.heliodonMode = 'dome')}>3D Dome</button>
        <button class:active={app.heliodonMode === 'camera'} onclick={() => (app.heliodonMode = 'camera')}>Camera AR</button>
      </div>
      <button class="btn ghost tiny" onclick={pullPython}>↻ Query Python</button>
    </div>
  </section>

  <!-- ============================================================== readings -->
  <section class="grid cols-4" style="margin-bottom: 1rem;">
    <div class="glass pad kpi">
      <p class="stat-label">Sun elevation</p>
      <p class="numeral stat-value" style="color: var(--gold)">{sun.elevation.toFixed(1)}°</p>
      <p class="tiny-text faint">live at {app.site.name}</p>
    </div>
    <div class="glass pad kpi">
      <p class="stat-label">Daylight</p>
      <p class="numeral stat-value">{dayEnergy.daylightHours.toFixed(2)}<span style="font-size:.6em"> h</span></p>
      <p class="tiny-text faint">declination {dayEnergy.declination.toFixed(2)}°</p>
    </div>
    <div class="glass pad kpi">
      <p class="stat-label">Peak POA</p>
      <p class="numeral stat-value" style="color: var(--cyan)">{dayEnergy.peakPoa.toFixed(0)}</p>
      <p class="tiny-text faint">W/m² plane-of-array</p>
    </div>
    <div class="glass pad kpi">
      <p class="stat-label">Array yield today</p>
      <p class="numeral stat-value" style="color: var(--emerald)">{dayEnergy.energyKwh.toFixed(2)}</p>
      <p class="tiny-text faint">{app.panel.kw} kW · shade-adjusted kWh</p>
    </div>
  </section>

  <!-- ============================================================== main view -->
  <div class="main-grid">
    <div class="view-col">
      {#if app.heliodonMode === 'dome'}
        <HeliodonDome />
      {:else}
        <ARCameraOverlay />
      {/if}
      <TimeScrubber />
    </div>

    <aside class="side-col">
      <!-- site picker -->
      <div class="glass tall">
        <div class="row between">
          <p class="eyebrow">GPS Ephemeris Coordinates</p>
          <span class="chip" class:ok={app.permissions.geolocation}>{app.sensorSource}</span>
        </div>
        <div class="sites">
          {#each PRESET_SITES as s}
            <button
              class="site-row"
              class:sel={app.site.id === s.id}
              onclick={() => { setSite(s); toast(`Site locked → ${s.name}`, 'success'); }}
            >
              <span class="site-name">{s.name}</span>
              <span class="mono tiny-text faint">{s.lat.toFixed(1)}°, {s.lon.toFixed(1)}°</span>
            </button>
          {/each}
        </div>
        <div class="divider"></div>
        <div class="row" style="gap:.4rem; flex-wrap:wrap;">
          <button class="btn ghost tiny" onclick={() => saveSiteSnapshot('heliodon-scan')}>💾 Save survey</button>
          <button class="btn ghost tiny" onclick={() => openModal('privileges')}>Sensor matrix</button>
        </div>
      </div>

      <!-- optimal tilt card -->
      <div class="glass tall">
        <p class="eyebrow">Optimum array tilt</p>
        <div class="tilt-grid">
          {#each [['today', 'Today only'], ['fixed', 'Fixed year-round'], ['winter', 'Winter max'], ['summer', 'Summer max']] as [key, label]}
            <button class="tilt-cell" class:sel={app.tiltMode === key} onclick={() => { app.tiltMode = key; app.panel.tilt = Math.round(tilts[key]); }}>
              <span class="tilt-num mono numeral">{tilts[key].toFixed(1)}°</span>
              <span class="tiny-text faint">{label}</span>
            </button>
          {/each}
        </div>
        <p class="tiny-text faint" style="margin-top:.5rem;">
          Rule of thumb: |lat| × 0.87 for fixed, lat + 15° for winter boost. Latitude
          <strong>{Math.abs(app.latitude).toFixed(2)}°</strong>.
        </p>
      </div>

      <!-- toggles -->
      <div class="glass pad">
        <p class="eyebrow" style="margin-bottom:.4rem;">Dome layers</p>
        <div class="toggle-list">
          <label class="toggle-row">
            <span class="small">Azimuth graticule</span>
            <button class="toggle" class:on={app.showGrid} onclick={() => (app.showGrid = !app.showGrid)} aria-pressed={app.showGrid} aria-label="Toggle graticule"></button>
          </label>
          <label class="toggle-row">
            <span class="small">Horizon obstruction</span>
            <button class="toggle" class:on={app.showObstruction} onclick={() => (app.showObstruction = !app.showObstruction)} aria-pressed={app.showObstruction} aria-label="Toggle obstruction"></button>
          </label>
          <label class="toggle-row">
            <span class="small">Optimum tilt ring</span>
            <button class="toggle" class:on={app.showTiltRing} onclick={() => (app.showTiltRing = !app.showTiltRing)} aria-pressed={app.showTiltRing} aria-label="Toggle tilt ring"></button>
          </label>
        </div>
      </div>
    </aside>
  </div>

  <!-- ========================================================= horizon editor -->
  <section style="margin-top: 1rem;">
    <HorizonEditor />
  </section>

  <!-- =========================================================== 365 curve -->
  <section class="glass tall" style="margin-top: 1rem;">
    <div class="row between" style="flex-wrap:wrap; gap:.4rem;">
      <div>
        <p class="eyebrow">365-day irradiance curve</p>
        <h3 style="font-size:1rem; margin-top:.12rem;">Plane-of-array insolation, {app.site.name}</h3>
      </div>
      <div class="row" style="gap:.35rem;">
        <span class="chip">tilt {app.panel.tilt}°</span>
        <span class="chip">azimuth {app.panel.azimuth}°</span>
        <button class="btn ghost tiny" onclick={() => openModal('export')}>Export CSV</button>
      </div>
    </div>
    <YearCurve />
  </section>
</div>

<style>
  .module {
    padding-block: 0.6rem 1.4rem;
  }

  .module-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 0.9rem;
  }

  .head-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .kpi .stat-value {
    font-size: 1.5rem;
  }

  .main-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(270px, 340px);
    gap: 1rem;
    align-items: start;
  }

  .view-col {
    display: grid;
    gap: 0.8rem;
    min-width: 0;
  }

  .side-col {
    display: grid;
    gap: 0.8rem;
  }

  .sites {
    display: grid;
    gap: 0.16rem;
    margin-top: 0.5rem;
    max-height: 232px;
    overflow-y: auto;
    padding-right: 0.2rem;
  }

  .site-row {
    display: grid;
    gap: 0.05rem;
    padding: 0.34rem 0.5rem;
    border-radius: 9px;
    text-align: left;
    border: 1px solid transparent;
    transition: background 180ms ease, border-color 180ms ease;
  }

  .site-row:hover {
    background: color-mix(in oklab, var(--surface-hi) 60%, transparent);
  }

  .site-row.sel {
    background: color-mix(in oklab, var(--gold) 14%, transparent);
    border-color: color-mix(in oklab, var(--gold) 38%, transparent);
  }

  .site-name {
    font-size: 0.78rem;
    font-weight: 640;
  }

  .tilt-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.34rem;
    margin-top: 0.5rem;
  }

  .tilt-cell {
    display: grid;
    gap: 0.05rem;
    padding: 0.5rem 0.55rem;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: color-mix(in oklab, var(--surface-solid) 48%, transparent);
    text-align: left;
    transition: all 200ms ease;
  }

  .tilt-cell:hover {
    border-color: var(--border-hi);
  }

  .tilt-cell.sel {
    border-color: color-mix(in oklab, var(--emerald) 50%, transparent);
    background: color-mix(in oklab, var(--emerald) 12%, transparent);
  }

  .tilt-num {
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--emerald);
  }

  .toggle-list {
    display: grid;
    gap: 0.42rem;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  @media (max-width: 1080px) {
    .main-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
