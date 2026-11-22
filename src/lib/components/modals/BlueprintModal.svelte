<script>
  /**
   * Shared-element destination: any saved site audit / battery config morphs
   * into this Engineering Blueprint & Python Math Inspector.
   */
  let { payload = null } = $props();

  import { onMount } from 'svelte';
  import { closeModal, app } from '$lib/state/app.svelte.js';
  import { optimalTilt, horizonEfficiency, annualYield, MONTH_NAMES } from '$lib/solar/kernel.js';

  const row = $derived(payload?.row ?? {});
  const kind = $derived(payload?.kind ?? 'site');

  const geometry = $derived.by(() => {
    if (kind === 'audit') return null;
    const lat = Number(row.lat ?? app.latitude);
    const lon = Number(row.lon ?? app.longitude);
    const tilt = Number(row.tilt ?? app.panel.tilt);
    const horizon = row.horizon ?? app.horizon;
    return {
      lat,
      lon,
      tilt,
      efficiency: horizonEfficiency(lat, lon, horizon, tilt, row.azimuth ?? 180),
      yield: annualYield(lat, lon, Number(row.kw ?? app.panel.kw), tilt, row.azimuth ?? 180, {
        horizon,
        years: 25
      }),
      winterTilt: optimalTilt(lat, 355, 'winter'),
      summerTilt: optimalTilt(lat, 172, 'summer')
    };
  });

  const auditRow = $derived(kind === 'audit' ? row : null);

  const pythonSnippet = $derived.by(() => {
    if (kind === 'audit') {
      return `from helio_kernel import audit_quote

verdict = audit_quote(
    latitude=${(auditRow?.result?.assumedTilt ? app.latitude : app.latitude).toFixed(4)},
    longitude=${app.longitude.toFixed(4)},
    system_kw=${app.quote.systemKw},
    quoted_price_usd=${app.quote.quotedPrice},
    promised_kwh_per_year=${app.quote.promisedKwh},
    utility_rate_usd=${app.quote.utilityRate},
    horizon=[${(app.horizon ?? []).map((h) => `{"azimuth": ${h.azimuth}, "elevation": ${h.elevation}}`).join(', ')}],
)
print(verdict["verdict"], verdict["dollarsPerWatt"])`;
    }
    return `from helio_kernel import (
    horizon_efficiency, annual_yield, optimal_tilt
)

site = dict(latitude=${Number(row.lat ?? app.latitude).toFixed(4)},
            longitude=${Number(row.lon ?? app.longitude).toFixed(4)})
horizon = [${(row.horizon ?? app.horizon ?? []).map((h) => `(${h.azimuth}, ${h.elevation})`).join(', ')}]

window = horizon_efficiency(
    **site, horizon=[{"azimuth": a, "elevation": e} for a, e in horizon],
    tilt=${Number(row.tilt ?? app.panel.tilt)}, panel_azimuth=${row.azimuth ?? 180},
)
yield_ = annual_yield(
    **site, kw_stc=${Number(row.kw ?? app.panel.kw)},
    tilt=${Number(row.tilt ?? app.panel.tilt)}, panel_azimuth=${row.azimuth ?? 180},
    years=25,
)
print(window["solarWindowEfficiency"], yield_["annualKwh"])`;
  });
</script>

<div class="bp glass">
  <header class="row between">
    <div>
      <p class="eyebrow" style="color: var(--gold)">Engineering Blueprint</p>
      <h2 class="display" style="font-size:1.5rem; margin-top:.2rem;">
        {kind === 'audit' ? row.company ?? 'Quote audit' : row.name ?? 'Site survey'}
      </h2>
      <p class="tiny-text faint">
        {kind === 'audit'
          ? `$${row.dollarsPerWatt}/W · ${Number(row.physicsKwhPerYear ?? 0).toLocaleString()} kWh/yr · ${row.verdict}`
          : `${row.kind ?? 'site'} · ${Number(row.lat ?? 0).toFixed(3)}°, ${Number(row.lon ?? 0).toFixed(3)}° · ${row.horizonCount ?? 0} horizon nodes`}
      </p>
    </div>
    <button class="btn icon ghost" onclick={closeModal} aria-label="Close">✕</button>
  </header>

  {#if geometry}
    <div class="grid cols-4">
      <div class="metric"><p class="stat-label">Solar window η</p><p class="numeral stat-value" style="color:var(--emerald)">{geometry.efficiency.solarWindowEfficiency}%</p></div>
      <div class="metric"><p class="stat-label">Year-1 yield</p><p class="numeral stat-value">{geometry.yield.annualKwh.toLocaleString()}</p><p class="tiny-text faint">kWh</p></div>
      <div class="metric"><p class="stat-label">Winter tilt</p><p class="numeral stat-value">{geometry.winterTilt.toFixed(0)}°</p></div>
      <div class="metric"><p class="stat-label">Summer tilt</p><p class="numeral stat-value">{geometry.summerTilt.toFixed(0)}°</p></div>
    </div>

    <div class="bp-grid">
      <div class="panel">
        <p class="eyebrow">Monthly yield projection (kWh)</p>
        <div class="mini-bars">
          {#each geometry.yield.monthlyKwh as v, i}
            {@const max = Math.max(...geometry.yield.monthlyKwh, 1)}
            <div class="mb">
              <span class="fill" style={`height:${Math.max(4, (v / max) * 100)}%`}></span>
              <span class="mono tiny-text faint">{MONTH_NAMES[i][0]}</span>
            </div>
          {/each}
        </div>
        <div class="divider"></div>
        <div class="brow"><span class="tiny-text faint">25-yr cumulative</span><span class="mono bold">{geometry.yield.degradationProjection.reduce((a, p) => a + p.kwh, 0).toLocaleString()} kWh</span></div>
        <div class="brow"><span class="tiny-text faint">Year-25 output</span><span class="mono bold">{geometry.yield.degradationProjection.at(-1)?.kwh.toLocaleString() ?? '—'} kWh</span></div>
        <div class="brow"><span class="tiny-text faint">Specific yield</span><span class="mono bold">{geometry.yield.specificYield} kWh/kW</span></div>
        <div class="brow"><span class="tiny-text faint">Capacity factor</span><span class="mono bold">{(geometry.yield.capacityFactor * 100).toFixed(1)}%</span></div>
      </div>

      <div class="panel">
        <div class="row between">
          <p class="eyebrow">Python 3.12 math inspector</p>
          <span class="chip tiny ok">helio_kernel.py</span>
        </div>
        <pre class="code mono"><code>{pythonSnippet}</code></pre>
        <p class="tiny-text faint" style="margin-top:.4rem;">
          Every number in this blueprint is reproducible by running the snippet above against the
          same kernel that powers the Vercel serverless function.
        </p>
      </div>
    </div>
  {:else}
    <div class="panel">
      <div class="row between">
        <p class="eyebrow">Audited findings</p>
        <span class="chip" class:ok={auditRow?.verdictClass === 'ok'} class:warn={auditRow?.verdictClass === 'warn'} class:critical={auditRow?.verdictClass === 'critical'}>{auditRow?.verdict}</span>
      </div>
      {#each auditRow?.result?.findings ?? [] as f}
        <div class="finding {f.severity}">
          <span class="dot"></span>
          <div>
            <p class="small bold">{f.title}</p>
            <p class="tiny-text faint">{f.detail}</p>
          </div>
        </div>
      {/each}
      <div class="divider"></div>
      <div class="brow"><span class="tiny-text faint">Payback</span><span class="mono bold">{auditRow?.paybackYears ?? '—'} yr</span></div>
      <div class="brow"><span class="tiny-text faint">Lifetime savings</span><span class="mono bold">${Number(auditRow?.result?.lifetimeSavingsUsd ?? 0).toLocaleString()}</span></div>
    </div>

    <div class="panel">
      <p class="eyebrow">Python 3.12 math inspector</p>
      <pre class="code mono"><code>{pythonSnippet}</code></pre>
    </div>
  {/if}
</div>

<style>
  .bp {
    padding: 1.25rem 1.4rem 1.15rem;
    display: grid;
    gap: 0.85rem;
  }

  .metric {
    padding: 0.55rem 0.65rem;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: color-mix(in oklab, var(--surface-solid) 44%, transparent);
  }

  .metric .stat-value { font-size: 1.25rem; }

  .bp-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
    gap: 0.8rem;
  }

  .panel {
    padding: 0.7rem 0.8rem;
    border-radius: 14px;
    border: 1px solid var(--border);
    background: color-mix(in oklab, var(--surface-solid) 40%, transparent);
  }

  .mini-bars {
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    gap: 0.22rem;
    align-items: end;
    height: 92px;
    margin-top: 0.45rem;
  }

  .mb {
    display: grid;
    justify-items: center;
    align-items: end;
    gap: 0.1rem;
    height: 100%;
  }

  .mb .fill {
    width: 100%;
    border-radius: 4px 4px 0 0;
    background: linear-gradient(180deg, #F59E0B, #06B6D4);
    align-self: end;
  }

  .brow {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.16rem 0;
  }

  .code {
    margin: 0.45rem 0 0;
    padding: 0.55rem 0.65rem;
    border-radius: 10px;
    background: #04070d;
    border: 1px solid var(--border);
    font-size: 0.66rem;
    line-height: 1.5;
    color: #bfe0f5;
    overflow-x: auto;
    white-space: pre;
  }

  .finding {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    padding: 0.45rem 0.55rem;
    border-radius: 10px;
    margin-top: 0.32rem;
    border: 1px solid var(--border);
  }

  .finding .dot { margin-top: 0.28rem; color: var(--cyan); }
  .finding.warn .dot { color: var(--gold); }
  .finding.critical .dot { color: var(--magenta); }

  @media (max-width: 860px) {
    .bp-grid { grid-template-columns: 1fr; }
  }
</style>
