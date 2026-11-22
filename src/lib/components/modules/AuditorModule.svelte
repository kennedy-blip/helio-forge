<script>
  import { app, can, openModal, toast } from '$lib/state/app.svelte.js';
  import { auditQuote, MONTH_NAMES, optimalTilt } from '$lib/solar/kernel.js';
  import { saveQuoteAudit } from '$lib/db/vault.js';
  import { ephemeris } from '$lib/solar/api.js';

  const audit = $derived(
    auditQuote({
      latitude: app.latitude,
      longitude: app.longitude,
      systemKw: app.quote.systemKw,
      quotedPriceUsd: app.quote.quotedPrice,
      promisedKwhPerYear: app.quote.promisedKwh,
      utilityRateUsd: app.quote.utilityRate,
      panelAzimuth: app.panel.azimuth,
      horizon: app.horizon,
      clearSkyIndex: app.quote.clearSkyIndex
    })
  );

  const CLIMATES = [
    { id: 0.86, label: 'High desert / Sahara' },
    { id: 0.78, label: 'Sunny continental' },
    { id: 0.72, label: 'Temperate (default)' },
    { id: 0.64, label: 'Humid subtropical' },
    { id: 0.55, label: 'Maritime / overcast' }
  ];

  const maxMonth = $derived(Math.max(...audit.monthlyKwh, 1));
  const unlocked = $derived(can('quote'));

  const toneClass = $derived(
    audit.verdictClass === 'ok' ? 'ok' : audit.verdictClass === 'warn' ? 'warn' : 'critical'
  );

  async function save() {
    await saveQuoteAudit(audit, app.quote.company);
  }

  async function pullPython() {
    const res = await ephemeris('quote', {
      latitude: app.latitude,
      longitude: app.longitude,
      systemKw: app.quote.systemKw,
      quotedPriceUsd: app.quote.quotedPrice,
      promisedKwhPerYear: app.quote.promisedKwh,
      utilityRateUsd: app.quote.utilityRate,
      panelAzimuth: app.panel.azimuth,
      horizon: app.horizon
    });
    toast(`${res.engine} audit · ${res.ms.toFixed(1)} ms`, 'success');
  }

  const perWattTone = $derived(
    audit.dollarsPerWatt > 4 ? 'critical' : audit.dollarsPerWatt > 3.2 ? 'warn' : 'ok'
  );
</script>

<div class="module">
  <section class="module-head">
    <div>
      <p class="eyebrow">Module 04 · Anti-Scam Rooftop ROI Verifier</p>
      <h1 class="display" style="font-size: clamp(1.5rem, 3.6vw, 2.2rem); margin-top:.2rem;">
        Solar Quote <span class="gradient-text">Auditor</span>
      </h1>
      <p class="small muted" style="margin-top:.3rem; max-width:64ch;">
        Enter the salesperson's numbers. The same NOAA/NREL ephemeris engine that drives the
        heliodon cross-checks the promised production against real latitude irradiance, your scanned
        skyline and 0.5%/yr panel degradation.
      </p>
    </div>
    <div class="row" style="gap:.35rem;">
      <button class="btn ghost tiny" onclick={pullPython}>↻ Query Python</button>
      <button class="btn primary tiny" onclick={save} disabled={!unlocked}>Save audit</button>
    </div>
  </section>

  <div class="audit-grid">
    <!-- ============================================================= inputs -->
    <div class="glass tall">
      <label class="field">
        <span>Installer / company</span>
        <input type="text" bind:value={app.quote.company} placeholder="SunPeak National" />
      </label>

      <div class="quote-fields">
        <label class="field">
          <span>System size (kW DC)</span>
          <input type="number" step="0.1" min="0.5" bind:value={app.quote.systemKw} />
        </label>
        <label class="field">
          <span>Quoted price ($)</span>
          <input type="number" step="250" min="0" bind:value={app.quote.quotedPrice} />
        </label>
        <label class="field">
          <span>Promised annual production (kWh/yr)</span>
          <input type="number" step="100" min="0" bind:value={app.quote.promisedKwh} />
        </label>
        <label class="field">
          <span>Utility rate ($/kWh)</span>
          <input type="number" step="0.005" min="0" bind:value={app.quote.utilityRate} />
        </label>
      </div>

      <div class="climate-row">
        <span class="label">Climate clear-sky index (k<sub>t</sub>)</span>
        <div class="climate-seg">
          {#each CLIMATES as c}
            <button
              class:active={Math.abs(app.quote.clearSkyIndex - c.id) < 0.005}
              onclick={() => { app.quote.clearSkyIndex = c.id; app.quote.climateLabel = c.label; }}
            >{c.label}</button>
          {/each}
        </div>
        <p class="tiny-text faint">
          k<sub>t</sub> = {app.quote.clearSkyIndex.toFixed(2)} — converts the cloudless NOAA model into a
          climatological annual average so the audit is comparable to a PVWatts run.
        </p>
      </div>

      <div class="primary-metrics">
        <div class="pm">
          <p class="stat-label">Cost per watt</p>
          <p class="numeral display" style="font-size:1.9rem; color: var(--{perWattTone === 'ok' ? 'emerald' : perWattTone === 'warn' ? 'gold' : 'magenta'})">
            ${audit.dollarsPerWatt.toFixed(2)}<span style="font-size:.42em">/W</span>
          </p>
          <p class="tiny-text faint">fair band $2.20 – $3.20/W</p>
        </div>
        <div class="pm">
          <p class="stat-label">Simple payback</p>
          <p class="numeral display" style="font-size:1.9rem;">{audit.paybackYears ?? '—'}<span style="font-size:.42em"> yr</span></p>
          <p class="tiny-text faint">at ${app.quote.utilityRate}/kWh</p>
        </div>
        <div class="pm">
          <p class="stat-label">25-year savings</p>
          <p class="numeral display" style="font-size:1.9rem; color: var(--cyan)">
            ${(audit.lifetimeSavingsUsd / 1000).toFixed(1)}k
          </p>
          <p class="tiny-text faint">with degradation</p>
        </div>
      </div>
    </div>

    <!-- ============================================================ verdict -->
    <div class="glass tall verdict-wrap" class:locked={!unlocked}>
      <p class="eyebrow">Audit verdict</p>
      <div class="verdict-badge {toneClass}">
        <span class="dot pulse"></span>
        <strong>{audit.verdict}</strong>
      </div>

      <div class="physics-check">
        <div class="pc-row">
          <span class="tiny-text faint">Physics-model production</span>
          <span class="mono bold">{audit.physicsKwhPerYear.toLocaleString()} kWh/yr</span>
        </div>
        <div class="pc-row">
          <span class="tiny-text faint">Quoted promise</span>
          <span class="mono bold" style="color: var(--gold)">{audit.promisedKwhPerYear.toLocaleString()} kWh/yr</span>
        </div>
        <div class="pc-bar">
          <span class="physics" style="width:{Math.min(100, (audit.physicsKwhPerYear / Math.max(audit.promisedKwhPerYear, audit.physicsKwhPerYear)) * 100)}%"></span>
          <span class="promise" style="width:{Math.min(100, (audit.promisedKwhPerYear / Math.max(audit.promisedKwhPerYear, audit.physicsKwhPerYear)) * 100)}%"></span>
        </div>
        <p class="tiny-text faint">
          Realisation ratio {audit.realisationRatio.toFixed(2)}× ·
          specific yield {audit.specificYield} kWh/kW/yr
        </p>
        <p class="tiny-text faint">
          Assumed tilt {audit.assumedTilt.toFixed(0)}° · azimuth {audit.assumedAzimuth}°
          {#if app.horizon.length}· {app.horizon.length}-node horizon applied{/if}
        </p>
      </div>

      <div class="findings">
        {#each audit.findings as f}
          <div class="finding {f.severity}">
            <span class="dot"></span>
            <div>
              <p class="small bold">{f.title}</p>
              <p class="tiny-text faint">{f.detail}</p>
            </div>
          </div>
        {:else}
          <div class="finding info">
            <span class="dot"></span>
            <div>
              <p class="small bold">No red flags detected</p>
              <p class="tiny-text faint">Pricing and production both sit inside the physical envelope for this latitude.</p>
            </div>
          </div>
        {/each}
      </div>

      {#if !unlocked}
        <button class="btn primary tiny full" style="margin-top:.6rem;" onclick={() => openModal('privileges')}>Unlock the full audit engine</button>
      {/if}
    </div>
  </div>

  <!-- ======================================================== monthly bars -->
  <section class="glass tall" style="margin-top:1rem;">
    <div class="row between">
      <div>
        <p class="eyebrow">Model-vs-promise, month by month</p>
        <h3 style="font-size:1rem; margin-top:.1rem;">Clear-sky physics yield</h3>
      </div>
      <span class="chip">year-1 = {audit.physicsKwhPerYear.toLocaleString()} kWh</span>
    </div>

    <div class="month-bars">
      {#each audit.monthlyKwh as v, i}
        <div class="mbar">
          <div class="bar-track">
            <span class="bar-fill" style="height:{Math.max(3, (v / maxMonth) * 100)}%"></span>
          </div>
          <span class="mono tiny-text faint">{MONTH_NAMES[i]}</span>
          <span class="mono tiny-text">{v.toFixed(0)}</span>
        </div>
      {/each}
    </div>

    <div class="negotiation">
      <p class="eyebrow" style="color: var(--gold)">Negotiation script</p>
      <p class="small">
        {#if audit.verdictClass === 'ok'}
          “Your pricing is fair. I'll sign if you include a 25-year production guarantee at
          {audit.physicsKwhPerYear.toLocaleString()} kWh/yr and a workmanship warranty of 10 years.”
        {:else}
          “Your quote is <strong>${audit.dollarsPerWatt.toFixed(2)}/W</strong> against a local fair-market
          ceiling of <strong>$3.20/W</strong>. At my latitude ({app.latitude.toFixed(1)}°) a clear-sky model
          yields <strong>{audit.physicsKwhPerYear.toLocaleString()} kWh/yr</strong>, not
          {audit.promisedKwhPerYear.toLocaleString()}. Re-price at
          <strong>${(3.2 * app.quote.systemKw * 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
          and I'll sign today.”
        {/if}
      </p>
    </div>
  </section>
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

  .audit-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(300px, 0.95fr);
    gap: 1rem;
    align-items: start;
  }

  .climate-row {
    display: grid;
    gap: 0.3rem;
    margin-top: 0.6rem;
    padding-top: 0.55rem;
    border-top: 1px solid var(--border);
  }

  .climate-seg {
    display: flex;
    flex-wrap: wrap;
    gap: 0.24rem;
  }

  .climate-seg button {
    padding: 0.26rem 0.52rem;
    border-radius: 999px;
    font-size: 0.65rem;
    font-weight: 620;
    border: 1px solid var(--border);
    color: var(--text-faint);
    transition: all 180ms ease;
  }

  .climate-seg button:hover { color: var(--text); border-color: var(--border-hi); }

  .climate-seg button.active {
    color: var(--text);
    background: color-mix(in oklab, var(--cyan) 16%, transparent);
    border-color: color-mix(in oklab, var(--cyan) 46%, transparent);
  }

  .quote-fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.55rem;
    margin-top: 0.6rem;
  }

  .primary-metrics {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
    margin-top: 0.75rem;
    padding-top: 0.7rem;
    border-top: 1px solid var(--border);
  }

  .verdict-wrap.locked { opacity: 0.96; }

  .verdict-badge {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.4rem;
    padding: 0.65rem 0.8rem;
    border-radius: 14px;
    font-size: 0.86rem;
    letter-spacing: 0.04em;
    border: 1px solid var(--border);
    background: color-mix(in oklab, var(--surface-solid) 60%, transparent);
  }

  .verdict-badge.ok {
    background: color-mix(in oklab, var(--emerald) 16%, transparent);
    border-color: color-mix(in oklab, var(--emerald) 44%, transparent);
    color: color-mix(in oklab, var(--emerald) 88%, white);
  }

  .verdict-badge.warn {
    background: color-mix(in oklab, var(--gold) 16%, transparent);
    border-color: color-mix(in oklab, var(--gold) 46%, transparent);
    color: color-mix(in oklab, var(--gold) 92%, white);
  }

  .verdict-badge.critical {
    background: color-mix(in oklab, var(--magenta) 18%, transparent);
    border-color: color-mix(in oklab, var(--magenta) 50%, transparent);
    color: color-mix(in oklab, var(--magenta) 90%, white);
  }

  .physics-check {
    display: grid;
    gap: 0.3rem;
    margin-top: 0.7rem;
  }

  .pc-row {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .pc-bar {
    display: flex;
    height: 7px;
    border-radius: 999px;
    overflow: hidden;
    background: rgba(0, 0, 0, 0.32);
    margin: 0.2rem 0;
  }

  .pc-bar .physics {
    background: linear-gradient(90deg, #22D3EE, #10B981);
  }

  .pc-bar .promise {
    background: linear-gradient(90deg, #F59E0B, #EC4899);
    opacity: 0.85;
  }

  .findings {
    display: grid;
    gap: 0.38rem;
    margin-top: 0.7rem;
  }

  .finding {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    padding: 0.5rem 0.62rem;
    border-radius: 11px;
    border: 1px solid var(--border);
    background: color-mix(in oklab, var(--surface-solid) 42%, transparent);
  }

  .finding .dot { margin-top: 0.28rem; color: var(--cyan); }
  .finding.warn .dot { color: var(--gold); }
  .finding.critical .dot { color: var(--magenta); }
  .finding.info .dot { color: var(--emerald); }
  .finding.critical {
    background: color-mix(in oklab, var(--magenta) 9%, transparent);
    border-color: color-mix(in oklab, var(--magenta) 28%, transparent);
  }

  .month-bars {
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    gap: 0.3rem;
    margin-top: 0.7rem;
    align-items: end;
  }

  .mbar {
    display: grid;
    justify-items: center;
    gap: 0.15rem;
  }

  .bar-track {
    display: flex;
    align-items: flex-end;
    width: 100%;
    height: 110px;
    border-radius: 7px;
    background: rgba(0, 0, 0, 0.22);
    border: 1px solid var(--border);
    overflow: hidden;
  }

  .bar-fill {
    width: 100%;
    border-radius: 6px 6px 0 0;
    background: linear-gradient(180deg, #F59E0B, #06B6D4 62%, #0e7490);
    box-shadow: 0 0 14px -3px rgba(245, 158, 11, 0.7);
    transition: height 480ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .negotiation {
    margin-top: 0.8rem;
    padding: 0.65rem 0.8rem;
    border-radius: 13px;
    background: color-mix(in oklab, var(--gold) 8%, transparent);
    border: 1px solid color-mix(in oklab, var(--gold) 26%, transparent);
  }

  @media (max-width: 1000px) {
    .audit-grid { grid-template-columns: 1fr; }
    .primary-metrics { grid-template-columns: 1fr 1fr; }
  }

  @media (max-width: 620px) {
    .climate-row {
    display: grid;
    gap: 0.3rem;
    margin-top: 0.6rem;
    padding-top: 0.55rem;
    border-top: 1px solid var(--border);
  }

  .climate-seg {
    display: flex;
    flex-wrap: wrap;
    gap: 0.24rem;
  }

  .climate-seg button {
    padding: 0.26rem 0.52rem;
    border-radius: 999px;
    font-size: 0.65rem;
    font-weight: 620;
    border: 1px solid var(--border);
    color: var(--text-faint);
    transition: all 180ms ease;
  }

  .climate-seg button:hover { color: var(--text); border-color: var(--border-hi); }

  .climate-seg button.active {
    color: var(--text);
    background: color-mix(in oklab, var(--cyan) 16%, transparent);
    border-color: color-mix(in oklab, var(--cyan) 46%, transparent);
  }

  .quote-fields { grid-template-columns: 1fr; }
    .month-bars { gap: 0.16rem; }
    .mbar .tiny-text:first-of-type { display: none; }
  }
</style>
