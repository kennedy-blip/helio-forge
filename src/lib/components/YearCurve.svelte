<script>
  /**
   * 365-day plane-of-array irradiance curve (SVG area chart, offline kernel).
   */
  import { app } from '$lib/state/app.svelte.js';
  import { annualIrradianceCurve, MONTH_NAMES } from '$lib/solar/kernel.js';

  /** @type {any} */
  let hover = $state(null);
  /** @type {SVGSVGElement | null} */
  let svgEl = $state(null);

  const curve = $derived(
    annualIrradianceCurve(app.latitude, app.longitude, app.panel.tilt, app.panel.azimuth, app.horizon ?? null)
  );

  const W = 720;
  const H = 210;
  const PAD = { l: 34, r: 8, t: 12, b: 20 };

  const max = $derived(Math.max(1, ...curve.map((p) => p.kwhM2)));
  const annual = $derived(curve.reduce((a, p) => a + p.kwhM2, 0));

  /** @param {number} doy */
  function x(doy) {
    return PAD.l + ((doy - 1) / 364) * (W - PAD.l - PAD.r);
  }

  /** @param {number} v */
  function y(v) {
    return H - PAD.b - (v / max) * (H - PAD.t - PAD.b);
  }

  const area = $derived(
    `M ${x(1)} ${y(0)} ` +
      curve.map((p) => `L ${x(p.doy).toFixed(1)} ${y(p.kwhM2).toFixed(1)}`).join(' ') +
      ` L ${x(365)} ${y(0)} Z`
  );
  const line = $derived(
    curve.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.doy).toFixed(1)} ${y(p.kwhM2).toFixed(1)}`).join(' ')
  );

  // month boundary ticks
  const monthTicks = $derived.by(() => {
    const ticks = [];
    let lastMonth = 0;
    for (const p of curve) {
      if (p.month !== lastMonth) {
        ticks.push({ doy: p.doy, month: p.month });
        lastMonth = p.month;
      }
    }
    return ticks;
  });

  /** @param {PointerEvent} e */
  function onMove(e) {
    const rect = svgEl?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const ratio = Math.max(0, Math.min(1, (px - PAD.l) / (W - PAD.l - PAD.r)));
    const doy = Math.round(1 + ratio * 364);
    hover = curve[doy - 1] ?? null;
  }
</script>

<div class="curve-wrap">
  <svg
    bind:this={svgEl}
    viewBox={`0 0 ${W} ${H}`}
    class="curve"
    onpointermove={onMove}
    onpointerleave={() => (hover = null)}
    role="img"
    aria-label="Annual plane of array irradiance curve"
  >
    <defs>
      <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#F59E0B" stop-opacity=".46" />
        <stop offset="55%" stop-color="#06B6D4" stop-opacity=".18" />
        <stop offset="100%" stop-color="#06B6D4" stop-opacity="0" />
      </linearGradient>
      <linearGradient id="curveStroke" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#F59E0B" />
        <stop offset="50%" stop-color="#22D3EE" />
        <stop offset="100%" stop-color="#F59E0B" />
      </linearGradient>
    </defs>

    <!-- horizontal grid -->
    {#each [0, 0.25, 0.5, 0.75, 1] as f}
      {@const val = max * f}
      <line x1={PAD.l} y1={y(val)} x2={W - PAD.r} y2={y(val)} stroke="rgba(148,180,220,.14)" stroke-width="0.7" />
      <text x={PAD.l - 5} y={y(val) + 3} text-anchor="end" fill="rgba(148,180,220,.55)" font-size="8" class="mono">
        {val.toFixed(1)}
      </text>
    {/each}

    <!-- month ticks -->
    {#each monthTicks as t}
      <line x1={x(t.doy)} y1={PAD.t} x2={x(t.doy)} y2={H - PAD.b} stroke="rgba(148,180,220,.11)" stroke-width="0.7" />
      <text x={x(t.doy) + 2} y={H - 7} fill="rgba(148,180,220,.5)" font-size="7.5" class="mono">
        {MONTH_NAMES[t.month - 1]}
      </text>
    {/each}

    <path d={area} fill="url(#curveFill)" />
    <path d={line} fill="none" stroke="url(#curveStroke)" stroke-width="1.9" stroke-linejoin="round" />

    {#if hover}
      <line x1={x(hover.doy)} y1={PAD.t} x2={x(hover.doy)} y2={H - PAD.b} stroke="rgba(255,255,255,.4)" stroke-dasharray="3 3" />
      <circle cx={x(hover.doy)} cy={y(hover.kwhM2)} r="3.6" fill="#fff" stroke="#F59E0B" stroke-width="2" />
      <g transform={`translate(${Math.min(x(hover.doy) + 8, W - 90)}, ${Math.max(y(hover.kwhM2) - 34, 4)})`}>
        <rect width="84" height="30" rx="7" fill="rgba(4,8,14,.9)" stroke="rgba(255,255,255,.16)" />
        <text x="7" y="12" fill="#FDE68A" font-size="8.5" class="mono">{MONTH_NAMES[hover.month - 1]} {hover.day}</text>
        <text x="7" y="24" fill="#e8f0fb" font-size="9" class="mono">{hover.kwhM2.toFixed(2)} kWh/m²</text>
      </g>
    {/if}
  </svg>

  <div class="curve-stats">
    <span class="chip">annual <strong class="mono">{annual.toFixed(0)}</strong> kWh/m²</span>
    <span class="chip">peak <strong class="mono">{max.toFixed(2)}</strong> kWh/m²/day</span>
    {#if app.horizon.length}<span class="chip warn">shade-adjusted</span>{/if}
  </div>
</div>

<style>
  .curve-wrap {
    margin-top: 0.5rem;
  }

  .curve {
    width: 100%;
    height: auto;
    display: block;
    cursor: crosshair;
  }

  .curve-stats {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
    margin-top: 0.3rem;
  }
</style>
