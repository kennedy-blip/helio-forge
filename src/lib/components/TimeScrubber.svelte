<script>
  /**
   * Hour-of-Day + Day-of-Year scrubber with live DNI / POA / power readouts.
   */
  import { app, haptic, sunNow } from '$lib/state/app.svelte.js';
  import { MONTH_NAMES, dayToDate, dayOfYear, solarDeclination, clearSkyIrradiance } from '$lib/solar/kernel.js';

  let dayTimer = null;

  const sun = $derived(sunNow());
  const sky = $derived(clearSkyIrradiance(sun.elevation, app.elevationM));
  const dateLabel = $derived.by(() => {
    const [m, d] = dayToDate(2025, app.dayOfYear);
    return `${MONTH_NAMES[m - 1]} ${d}`;
  });

  const clockLabel = $derived.by(() => {
    const minutes = app.timeMode === 'live' ? app.minuteOfDay : app.scrubHour * 60;
    const local = (((minutes + app.timezoneOffset * 60) % 1440) + 1440) % 1440;
    const hh = Math.floor(local / 60);
    const mm = Math.round(local % 60);
    return `${String(hh).padStart(2, '0')}:${String(Math.abs(mm)).padStart(2, '0')}`;
  });

  /** @param {number} month @param {number} day */
  function jumpSeason(month, day) {
    app.dayOfYear = dayOfYear(2025, month, day);
    haptic([8, 24, 8]);
  }

  const declination = $derived(solarDeclination(app.dayOfYear));
</script>

<div class="scrub glass tall">
  <div class="row between" style="flex-wrap:wrap; gap:.4rem;">
    <div>
      <p class="eyebrow">Heliodon ephemeris scrubber</p>
      <h3 class="row" style="gap:.5rem; font-size:1.02rem; margin-top:.14rem;">
        <span class="mono numeral" style="color: var(--gold)">{clockLabel}</span>
        <span class="faint">·</span>
        <span class="mono numeral">{dateLabel}</span>
        <span class="chip tiny">day {app.dayOfYear}</span>
      </h3>
    </div>
    <div class="seg">
      <button class:active={app.timeMode === 'live'} onclick={() => (app.timeMode = 'live')}>Live clock</button>
      <button class:active={app.timeMode === 'scrub'} onclick={() => (app.timeMode = 'scrub')}>Scrub</button>
    </div>
  </div>

  <div class="scrub-body">
    <label class="slider-block">
      <span class="row between">
        <span class="label">Hour of day · 00:00 – 23:59</span>
        <span class="mono tiny-text faint">{clockLabel}</span>
      </span>
      <input
        type="range" min="0" max="23.98" step="0.02"
        value={app.timeMode === 'scrub' ? app.scrubHour : app.minuteOfDay / 60}
        oninput={(e) => {
          app.timeMode = 'scrub';
          app.scrubHour = +e.currentTarget.value;
        }}
      />
      <div class="tick-row">
        {#each ['00', '06', '12', '18', '24'] as t}<span class="mono tiny-text faint">{t}</span>{/each}
      </div>
    </label>

    <label class="slider-block">
      <span class="row between">
        <span class="label">Day of year · 1 – 365</span>
        <span class="mono tiny-text faint">{dateLabel}</span>
      </span>
      <input
        type="range" min="1" max="365" step="1"
        value={app.dayOfYear}
        oninput={(e) => {
          app.timeMode = 'scrub';
          app.dayOfYear = +e.currentTarget.value;
        }}
      />
      <div class="tick-row">
        {#each MONTH_NAMES as m}<span class="mono tiny-text faint">{m[0]}</span>{/each}
      </div>
    </label>
  </div>

  <div class="season-row">
    <button class="btn ghost tiny" onclick={() => jumpSeason(6, 21)}>☀ Summer solstice</button>
    <button class="btn ghost tiny" onclick={() => jumpSeason(3, 20)}>⚖ Equinox</button>
    <button class="btn ghost tiny" onclick={() => jumpSeason(12, 21)}>❄ Winter solstice</button>
    <button class="btn ghost tiny" onclick={() => { const n = new Date(); app.dayOfYear = dayOfYear(n.getFullYear(), n.getMonth() + 1, n.getDate()); app.timeMode = 'live'; }}>Today</button>
  </div>

  <div class="irradiance-row">
    <div class="irr">
      <p class="stat-label">Elevation α</p>
      <p class="numeral stat-value" style="color: var(--gold)">{sun.elevation.toFixed(1)}°</p>
    </div>
    <div class="irr">
      <p class="stat-label">Azimuth</p>
      <p class="numeral stat-value">{sun.azimuth.toFixed(0)}°</p>
    </div>
    <div class="irr">
      <p class="stat-label">DNI</p>
      <p class="numeral stat-value" style="color: var(--coral)">{sky.dni.toFixed(0)}</p>
      <p class="tiny-text faint">W/m²</p>
    </div>
    <div class="irr">
      <p class="stat-label">GHI</p>
      <p class="numeral stat-value">{sky.ghi.toFixed(0)}</p>
      <p class="tiny-text faint">W/m²</p>
    </div>
    <div class="irr">
      <p class="stat-label">Declination δ</p>
      <p class="numeral stat-value">{declination.toFixed(1)}°</p>
    </div>
    <div class="irr">
      <p class="stat-label">Air mass</p>
      <p class="numeral stat-value">{sky.airMass.toFixed(2)}</p>
      <p class="tiny-text faint">AM</p>
    </div>
  </div>
</div>

<style>
  .scrub {
    display: grid;
    gap: 0.6rem;
  }

  .scrub-body {
    display: grid;
    gap: 0.5rem;
  }

  .slider-block {
    display: grid;
    gap: 0.1rem;
  }

  .tick-row {
    display: flex;
    justify-content: space-between;
    padding: 0 3px;
    margin-top: -0.3rem;
  }

  .season-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.34rem;
  }

  .irradiance-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(84px, 1fr));
    gap: 0.4rem;
    padding-top: 0.55rem;
    border-top: 1px solid var(--border);
  }

  .irr .stat-value {
    font-size: 1.18rem;
    line-height: 1.1;
  }

  .irr .stat-label {
    font-size: 0.58rem;
  }

  .irr .tiny-text {
    font-size: 0.6rem;
  }
</style>
