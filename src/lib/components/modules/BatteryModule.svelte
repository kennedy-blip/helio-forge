<script>
  import SocWaveform from '$lib/components/SocWaveform.svelte';
  import { app, can, toggleLoad, toast, openModal } from '$lib/state/app.svelte.js';
  import {
    BATTERY_CHEMISTRY,
    batteryAutonomy,
    simulateSoc,
    stringSizing,
    optimalTilt
  } from '$lib/solar/kernel.js';
  import { STOCK_CONTROLLERS } from '$lib/data/sites.js';
  import { saveBatteryConfig } from '$lib/db/vault.js';
  import { ephemeris } from '$lib/solar/api.js';

  /** @type {any} */
  const CHEM = BATTERY_CHEMISTRY;
  const chem = $derived(CHEM[app.battery.chemistry] ?? CHEM.lifepo4);
  const activeLoads = $derived(app.loads.filter((l) => l.on));
  const totalWatts = $derived(activeLoads.reduce((a, l) => a + l.watts, 0));
  const dailyWh = $derived(activeLoads.reduce((a, l) => a + l.watts * l.hoursPerDay, 0));

  const autonomy = $derived(
    batteryAutonomy(app.battery.chemistry, app.battery.capacityAh, app.battery.voltage, totalWatts, {
      dodPct: app.battery.dodPct,
      inverterEfficiencyPct: app.battery.inverterPct,
      temperatureC: app.battery.temperatureC
    })
  );

  const sim = $derived.by(() => {
    const tilt = optimalTilt(app.latitude, app.dayOfYear, 'fixed');
    return simulateSoc(
      app.battery.chemistry,
      app.battery.capacityAh,
      app.battery.voltage,
      activeLoads.map((l) => ({ watts: l.watts, hoursPerDay: l.hoursPerDay })),
      app.battery.arrayKw,
      tilt,
      app.panel.azimuth,
      app.latitude,
      app.longitude,
      app.dayOfYear,
      {
        dodPct: app.battery.dodPct,
        inverterEfficiencyPct: app.battery.inverterPct,
        initialSocPct: 100,
        ambientC: app.ambientC,
        horizon: app.horizon ?? null,
        hours: 48
      }
    );
  });

  const stringsUnlocked = $derived(can('strings'));
  const controller = $derived(
    STOCK_CONTROLLERS.find(
      (c) => c.maxVoc === app.string.controllerMaxVoc && c.amps === app.string.maxAmps
    ) ?? STOCK_CONTROLLERS[0]
  );
  const strings = $derived(
    stringSizing({
      panelVoc: app.string.panelVoc,
      panelVmp: app.string.panelVmp,
      panelIsc: app.string.panelIsc,
      panelWatt: app.string.panelWatt,
      panelsSeries: app.string.series,
      stringsParallel: app.string.parallel,
      controllerMaxVoc: app.string.controllerMaxVoc,
      controllerMpptLow: app.string.mpptLow,
      controllerMpptHigh: app.string.mpptHigh,
      controllerMaxAmps: app.string.maxAmps,
      recordLowC: app.string.recordLowC
    })
  );

  const runtimeLabel = $derived.by(() => {
    if (autonomy.runtimeHours === null) return '∞';
    const h = autonomy.runtimeHours;
    if (h >= 48) return `${(h / 24).toFixed(1)} days`;
    return `${Math.floor(h)}h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}m`;
  });

  const verdict = $derived.by(() => {
    if (!sim.survives) {
      return {
        tone: 'critical',
        label: 'BLACKOUT PREDICTED',
        text: `Battery hits 0% at ${sim.blackout?.clock} on day ${sim.blackout?.day}. Add ${Math.max(1, Math.ceil(-sim.netKwh / 6))} more kW of array or shed ${Math.abs(sim.netKwh / 24 * 1000).toFixed(0)} Wh/day of load.`
      };
    }
    const minSoc = Math.min(...sim.samples.map((s) => s.socPct));
    return {
      tone: minSoc > 40 ? 'ok' : 'warn',
      label: minSoc > 40 ? 'INDEFINITE OFF-GRID SURVIVAL' : 'SURVIVES — TIGHT MARGIN',
      text: `Lowest SoC reached ${minSoc.toFixed(0)}%. Net ${sim.netKwh >= 0 ? '+' : ''}${sim.netKwh} kWh over 48 h.`
    };
  });

  function applyController(c) {
    app.string.controllerMaxVoc = c.maxVoc;
    app.string.mpptLow = c.low;
    app.string.mpptHigh = c.high;
    app.string.maxAmps = c.amps;
    toast(`Controller → ${c.name}`, 'success');
  }

  async function pullSoc() {
    const res = await ephemeris('soc', {
      chemistry: app.battery.chemistry,
      capacityAh: app.battery.capacityAh,
      voltage: app.battery.voltage,
      loads: activeLoads.map((l) => ({ watts: l.watts, hoursPerDay: l.hoursPerDay })),
      arrayKw: app.battery.arrayKw,
      tilt: optimalTilt(app.latitude, app.dayOfYear, 'fixed'),
      panelAzimuth: app.panel.azimuth,
      latitude: app.latitude,
      longitude: app.longitude,
      doy: app.dayOfYear,
      dodPct: app.battery.dodPct,
      inverterEfficiencyPct: app.battery.inverterPct,
      ambientC: app.ambientC,
      horizon: app.horizon,
      hours: 48
    });
    toast(`${res.engine} SoC sim · ${res.ms.toFixed(1)} ms`, 'success');
  }
</script>

<div class="module">
  <section class="module-head">
    <div>
      <p class="eyebrow">Module 03 · Peukert's Law Blackout Autonomy</p>
      <h1 class="display" style="font-size: clamp(1.5rem, 3.6vw, 2.2rem); margin-top:.2rem;">
        Off-Grid <span class="gradient-text">Battery Forge</span>
      </h1>
      <p class="small muted" style="margin-top:.3rem; max-width:62ch;">
        Will your battery survive the night? Peukert-corrected capacity, DoD limits, inverter losses
        and clear-sky solar recharge — modelled hour by hour against the real sun at your latitude.
      </p>
    </div>
    <div class="row" style="gap:.35rem;">
      <button class="btn ghost tiny" onclick={pullSoc}>↻ Query Python</button>
      <button class="btn ghost tiny" onclick={() => saveBatteryConfig(autonomy)}>💾 Save config</button>
    </div>
  </section>

  <div class="battery-grid">
    <!-- ============================================================ config -->
    <div class="glass tall">
      <p class="eyebrow">Battery chemistry & bank</p>
      <div class="chem-grid">
        {#each /** @type {[string, any][]} */ (Object.entries(BATTERY_CHEMISTRY)) as [id, c]}
          <button class="chem" class:sel={app.battery.chemistry === id} onclick={() => (app.battery.chemistry = id)}
            style={`--accent:${c.color}`}>
            <span class="chem-name">{c.label}</span>
            <span class="tiny-text faint">k = {c.k} · {c.cycles} cycles</span>
            <span class="chem-dod mono tiny-text">DoD ≤ {(c.dodMax * 100).toFixed(0)}%</span>
          </button>
        {/each}
      </div>

      <div class="divider"></div>

      <div class="cfg-grid">
        <label class="field">
          <span>Capacity</span>
          <div class="row">
            <input type="range" min="50" max="1200" step="10" bind:value={app.battery.capacityAh} />
            <span class="mono tiny-text nowrap">{app.battery.capacityAh} Ah</span>
          </div>
        </label>
        <div class="field">
          <span>Bank voltage</span>
          <div class="seg">
            {#each [12, 24, 48] as v}
              <button class:active={app.battery.voltage === v} onclick={() => (app.battery.voltage = v)}>{v}V</button>
            {/each}
          </div>
        </div>
        <label class="field">
          <span>Depth of discharge</span>
          <div class="row">
            <input type="range" min="20" max="100" step="1" bind:value={app.battery.dodPct} />
            <span class="mono tiny-text nowrap">{app.battery.dodPct}%</span>
          </div>
        </label>
        <label class="field">
          <span>Inverter efficiency</span>
          <div class="row">
            <input type="range" min="70" max="98" step="1" bind:value={app.battery.inverterPct} />
            <span class="mono tiny-text nowrap">{app.battery.inverterPct}%</span>
          </div>
        </label>
        <label class="field">
          <span>Battery temperature</span>
          <div class="row">
            <input type="range" min="-20" max="45" step="1" bind:value={app.battery.temperatureC} />
            <span class="mono tiny-text nowrap">{app.battery.temperatureC}°C</span>
          </div>
        </label>
        <label class="field">
          <span>Solar array</span>
          <div class="row">
            <input type="range" min="0.2" max="16" step="0.2" bind:value={app.battery.arrayKw} />
            <span class="mono tiny-text nowrap">{app.battery.arrayKw} kW</span>
          </div>
        </label>
      </div>

      <div class="autonomy-readout">
        <div>
          <p class="stat-label">Runtime at {totalWatts} W</p>
          <p class="numeral display" style="font-size:1.9rem; color: var(--gold)">{runtimeLabel}</p>
        </div>
        <div class="bankstats">
          <span class="chip">nominal {autonomy.nominalWh.toFixed(0)} Wh</span>
          <span class="chip ok">usable {autonomy.usableWh.toFixed(0)} Wh</span>
          <span class="chip">draw {autonomy.drawAmps} A</span>
          <span class="chip">k {autonomy.peukertExponent}</span>
          {#if autonomy.coldDerate < 0.99}<span class="chip warn">cold derate {(autonomy.coldDerate * 100).toFixed(0)}%</span>{/if}
        </div>
      </div>
    </div>

    <!-- ============================================================= loads -->
    <div class="glass tall">
      <div class="row between">
        <p class="eyebrow">Appliance load matrix</p>
        <div class="row" style="gap:.3rem;">
          <span class="chip">{activeLoads.length} on</span>
          <span class="chip solid">{totalWatts} W</span>
        </div>
      </div>

      <div class="load-list">
        {#each app.loads as l}
          <div class="load-row" class:on={l.on}>
            <span class="load-icon">{l.icon}</span>
            <span class="load-main">
              <span class="small bold">{l.name}</span>
              <span class="tiny-text faint">{l.watts} W · {l.hoursPerDay} h/day · {(l.watts * l.hoursPerDay).toFixed(0)} Wh</span>
            </span>
            <button class="toggle" class:on={l.on} onclick={() => toggleLoad(l.id)} aria-pressed={l.on} aria-label={`Toggle ${l.name}`}></button>
          </div>
        {/each}
      </div>

      <div class="divider"></div>
      <div class="row between">
        <span class="tiny-text faint">Total daily energy</span>
        <span class="mono bold">{(dailyWh / 1000).toFixed(2)} kWh/day</span>
      </div>
    </div>
  </div>

  <!-- ============================================================= waveform -->
  <section class="glass tall" style="margin-top:1rem;">
    <div class="row between" style="flex-wrap:wrap; gap:.4rem;">
      <div>
        <p class="eyebrow">48-hour charge vs. discharge waveform</p>
        <h3 style="font-size:1rem; margin-top:.1rem;">State of Charge vs. solar recharge</h3>
      </div>
      <span class="chip" class:ok={verdict.tone === 'ok'} class:warn={verdict.tone === 'warn'} class:critical={verdict.tone === 'critical'}>
        {verdict.label}
      </span>
    </div>

    <SocWaveform samples={sim.samples} blackout={sim.blackout} />

    <div class="verdict-card" class:bad={verdict.tone === 'critical'} class:mid={verdict.tone === 'warn'}>
      <span class="dot"></span>
      <p class="small">{verdict.text}</p>
    </div>

    <div class="grid cols-4" style="margin-top:.6rem;">
      <div class="mini"><p class="stat-label">Solar in</p><p class="numeral stat-value" style="color:var(--gold)">{sim.totalSolarKwh}</p><p class="tiny-text faint">kWh / 48 h</p></div>
      <div class="mini"><p class="stat-label">Load out</p><p class="numeral stat-value" style="color:var(--magenta)">{sim.totalLoadKwh}</p><p class="tiny-text faint">kWh / 48 h</p></div>
      <div class="mini"><p class="stat-label">Net</p><p class="numeral stat-value" style="color:{sim.netKwh >= 0 ? 'var(--emerald)' : 'var(--magenta)'}">{sim.netKwh >= 0 ? '+' : ''}{sim.netKwh}</p><p class="tiny-text faint">kWh balance</p></div>
      <div class="mini"><p class="stat-label">Min SoC</p><p class="numeral stat-value">{Math.min(...sim.samples.map((s) => s.socPct)).toFixed(0)}%</p><p class="tiny-text faint">lowest dip</p></div>
    </div>
  </section>

  <!-- ============================================================== strings -->
  <section class="glass tall strings" class:locked={!stringsUnlocked} style="margin-top:1rem;">
    <div class="row between" style="flex-wrap:wrap; gap:.4rem;">
      <div>
        <p class="eyebrow" style="color: var(--cyan)">Pro / Admin · Series vs. Parallel MPPT String Sizer</p>
        <h3 style="font-size:1.02rem; margin-top:.1rem;">Cold-weather V<sub>oc</sub> spike protection</h3>
      </div>
      <div class="row" style="gap:.35rem;">
        <span class="chip" class:ok={strings.status === 'PASS'} class:warn={strings.status === 'CAUTION'} class:critical={strings.status === 'FAIL'}>{strings.status}</span>
        {#if !stringsUnlocked}<button class="btn primary tiny" onclick={() => openModal('privileges')}>Unlock Pro</button>{/if}
      </div>
    </div>

    {#if stringsUnlocked}
      <div class="string-grid">
        <div class="string-controls">
          <div class="srow">
            <label class="field"><span>Panels in series</span>
              <input type="range" min="1" max="12" step="1" bind:value={app.string.series} />
              <span class="mono tiny-text">{app.string.series}</span>
            </label>
            <label class="field"><span>Strings in parallel</span>
              <input type="range" min="1" max="6" step="1" bind:value={app.string.parallel} />
              <span class="mono tiny-text">{app.string.parallel}</span>
            </label>
          </div>
          <div class="srow">
            <label class="field"><span>Panel V<sub>oc</sub> (STC)</span><input type="number" step="0.1" bind:value={app.string.panelVoc} /></label>
            <label class="field"><span>Panel V<sub>mp</sub></span><input type="number" step="0.1" bind:value={app.string.panelVmp} /></label>
          </div>
          <div class="srow">
            <label class="field"><span>Panel I<sub>sc</sub></span><input type="number" step="0.1" bind:value={app.string.panelIsc} /></label>
            <label class="field"><span>Panel watts</span><input type="number" step="5" bind:value={app.string.panelWatt} /></label>
          </div>
          <label class="field">
            <span>MPPT charge controller</span>
            <select
              value={controller.id}
              onchange={(e) => applyController(STOCK_CONTROLLERS.find((c) => c.id === e.currentTarget.value))}
            >
              {#each STOCK_CONTROLLERS as c}
                <option value={c.id}>{c.name} · {c.maxVoc}V / {c.amps}A</option>
              {/each}
            </select>
          </label>
          <label class="field">
            <span>Record low temperature</span>
            <div class="row">
              <input type="range" min="-35" max="10" step="1" bind:value={app.string.recordLowC} />
              <span class="mono tiny-text nowrap">{app.string.recordLowC}°C</span>
            </div>
          </label>
        </div>

        <div class="string-results">
          <div class="sres">
            <p class="stat-label">Cold V<sub>oc</sub> per panel</p>
            <p class="numeral stat-value" style="color: var(--cyan)">{strings.vocColdPerPanel} V</p>
            <p class="tiny-text faint">at {app.string.recordLowC}°C (−0.29%/°C)</p>
          </div>
          <div class="sres">
            <p class="stat-label">String cold V<sub>oc</sub></p>
            <p class="numeral stat-value" style="color:{strings.headroomV < 0 ? 'var(--magenta)' : 'var(--emerald)'}">{strings.vocColdString} V</p>
            <p class="tiny-text faint">controller limit {app.string.controllerMaxVoc} V</p>
          </div>
          <div class="sres">
            <p class="stat-label">Hot V<sub>mp</sub> string</p>
            <p class="numeral stat-value">{strings.vmpHotString} V</p>
            <p class="tiny-text faint">MPPT window {app.string.mpptLow}–{app.string.mpptHigh} V</p>
          </div>
          <div class="sres">
            <p class="stat-label">Array power</p>
            <p class="numeral stat-value" style="color: var(--gold)">{(strings.arrayWatts / 1000).toFixed(2)} kW</p>
            <p class="tiny-text faint">{app.string.series}S {app.string.parallel}P · {strings.iscDerated} A</p>
          </div>
        </div>
      </div>

      <div class="headroom">
        <div class="headroom-bar">
          <span class="used" style={`width:${Math.min(100, Math.max(0, (strings.vocColdString / app.string.controllerMaxVoc) * 100))}%`}></span>
          <span class="limit" style="left:90%"></span>
        </div>
        <p class="tiny-text faint">
          {strings.headroomV >= 0 ? `${strings.headroomV} V headroom` : `${Math.abs(strings.headroomV)} V OVER the controller`}
          · {strings.vocMarginPct}% margin
        </p>
      </div>

      {#each [...strings.violations, ...strings.warnings] as msg}
        <div class="alert">
          <span class="dot" style="color: var(--magenta)"></span>
          <p class="tiny-text">{msg}</p>
        </div>
      {/each}
      {#if strings.status === 'PASS'}
        <div class="alert ok">
          <span class="dot" style="color: var(--emerald)"></span>
          <p class="tiny-text">Safe at {app.string.recordLowC}°C — no cold-snap overvoltage, no hot-day MPPT dropout.</p>
        </div>
      {/if}
    {:else}
      <p class="small muted" style="margin-top:.6rem;">
        The MPPT string architect is a Pro-tier capability. It protects against the coldest-morning
        V<sub>oc</sub> spike that destroys charge controllers.
      </p>
    {/if}
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

  .battery-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(280px, 0.75fr);
    gap: 1rem;
    align-items: start;
  }

  .chem-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 0.36rem;
    margin-top: 0.5rem;
  }

  .chem {
    display: grid;
    gap: 0.08rem;
    padding: 0.5rem 0.55rem;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: color-mix(in oklab, var(--surface-solid) 45%, transparent);
    text-align: left;
    transition: all 200ms ease;
    position: relative;
    overflow: hidden;
  }

  .chem::before {
    content: '';
    position: absolute;
    inset: auto 0 0 0;
    height: 2px;
    background: var(--accent);
    opacity: 0.5;
  }

  .chem:hover { border-color: var(--border-hi); }

  .chem.sel {
    border-color: color-mix(in oklab, var(--accent) 60%, transparent);
    background: color-mix(in oklab, var(--accent) 12%, transparent);
  }

  .chem.sel::before { opacity: 1; }

  .chem-name { font-size: 0.8rem; font-weight: 680; }
  .chem-dod { color: var(--accent); }

  .cfg-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 0.55rem;
  }

  .autonomy-readout {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    margin-top: 0.7rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--border);
    flex-wrap: wrap;
  }

  .bankstats {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    justify-content: flex-end;
  }

  .load-list {
    display: grid;
    gap: 0.22rem;
    margin-top: 0.5rem;
  }

  .load-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.34rem 0.45rem;
    border-radius: 10px;
    border: 1px solid transparent;
    opacity: 0.55;
    transition: all 200ms ease;
  }

  .load-row.on {
    opacity: 1;
    background: color-mix(in oklab, var(--emerald) 8%, transparent);
    border-color: color-mix(in oklab, var(--emerald) 24%, transparent);
  }

  .load-icon { font-size: 0.95rem; }

  .load-main {
    display: grid;
    gap: 0.04rem;
    flex: 1;
    min-width: 0;
  }

  .verdict-card {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    margin-top: 0.5rem;
    padding: 0.55rem 0.7rem;
    border-radius: 12px;
    background: color-mix(in oklab, var(--emerald) 10%, transparent);
    border: 1px solid color-mix(in oklab, var(--emerald) 30%, transparent);
  }

  .verdict-card .dot { color: var(--emerald); margin-top: 0.28rem; }

  .verdict-card.mid {
    background: color-mix(in oklab, var(--gold) 10%, transparent);
    border-color: color-mix(in oklab, var(--gold) 32%, transparent);
  }

  .verdict-card.mid .dot { color: var(--gold); }

  .verdict-card.bad {
    background: color-mix(in oklab, var(--magenta) 12%, transparent);
    border-color: color-mix(in oklab, var(--magenta) 36%, transparent);
  }

  .verdict-card.bad .dot { color: var(--magenta); }

  .mini {
    padding: 0.5rem 0.6rem;
    border-radius: 12px;
    background: color-mix(in oklab, var(--surface-solid) 46%, transparent);
    border: 1px solid var(--border);
  }

  .mini .stat-value { font-size: 1.18rem; }

  .string-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 1rem;
    margin-top: 0.6rem;
  }

  .string-controls { display: grid; gap: 0.5rem; }

  .srow {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  .string-results {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.45rem;
    align-content: start;
  }

  .sres {
    padding: 0.5rem 0.6rem;
    border-radius: 12px;
    background: color-mix(in oklab, var(--surface-solid) 46%, transparent);
    border: 1px solid var(--border);
  }

  .sres .stat-value { font-size: 1.16rem; }

  .headroom { margin-top: 0.6rem; }

  .headroom-bar {
    position: relative;
    height: 8px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.34);
    overflow: hidden;
  }

  .headroom-bar .used {
    display: block;
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, #22D3EE, #F59E0B 70%, #EC4899);
    transition: width 420ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .headroom-bar .limit {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: rgba(255, 255, 255, 0.5);
  }

  .alert {
    display: flex;
    align-items: flex-start;
    gap: 0.45rem;
    margin-top: 0.4rem;
    padding: 0.45rem 0.6rem;
    border-radius: 10px;
    background: color-mix(in oklab, var(--magenta) 9%, transparent);
    border: 1px solid color-mix(in oklab, var(--magenta) 26%, transparent);
  }

  .alert.ok {
    background: color-mix(in oklab, var(--emerald) 9%, transparent);
    border-color: color-mix(in oklab, var(--emerald) 26%, transparent);
  }

  .alert .dot { margin-top: 0.24rem; }

  @media (max-width: 1000px) {
    .battery-grid, .string-grid { grid-template-columns: 1fr; }
  }
</style>
