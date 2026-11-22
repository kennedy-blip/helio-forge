<script>
  /**
   * Liquid-glass tilt reticle + cosine-incidence efficiency gauge.
   * The needle uses a native svelte/motion spring.
   */
  import { spring } from 'svelte/motion';
  import { onMount } from 'svelte';
  import { app, haptic, toast } from '$lib/state/app.svelte.js';
  import { cosineEfficiency } from '$lib/solar/kernel.js';
  import { sunNow } from '$lib/state/app.svelte.js';

  let { target = 30, live = 30, azimuth = 180, editable = true } = $props();

  const needle = spring(30, { stiffness: 0.18, damping: 0.68 });
  let locked = $state(false);
  let lastLock = false;

  const sun = $derived(sunNow());
  const efficiency = $derived(cosineEfficiency(sun.elevation, sun.azimuth, live, azimuth));
  const delta = $derived(live - target);
  const inLock = $derived(Math.abs(delta) <= 0.5);

  $effect(() => {
    needle.set(live);
  });

  $effect(() => {
    if (inLock && !lastLock) {
      locked = true;
      haptic([18, 50, 18]);
      toast(`Tilt locked · ${live.toFixed(1)}° (η ${(efficiency * 100).toFixed(1)}%)`, 'success');
      setTimeout(() => (locked = false), 1600);
    }
    lastLock = inLock;
  });

  const R = 118;
  const cx = 150;
  const cy = 142;

  function polar(angleDeg, r) {
    const a = ((angleDeg - 90) * Math.PI) / 180;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  }

  // Map tilt 0..90 -> -60..+60 degrees of needle sweep for legibility
  const sweep = (t) => -60 + (Math.max(0, Math.min(90, t)) / 90) * 120;

  const ticks = $derived.by(() => {
    const out = [];
    for (let t = 0; t <= 90; t += 5) {
      const a = sweep(t);
      const major = t % 15 === 0;
      const [x1, y1] = polar(a, R - (major ? 12 : 7));
      const [x2, y2] = polar(a, R);
      const [tx, ty] = polar(a, R - 24);
      out.push({ t, x1, y1, x2, y2, tx, ty, major });
    }
    return out;
  });

  const arcPath = $derived.by(() => {
    const start = sweep(0);
    const end = sweep(90);
    const [sx, sy] = polar(start, R);
    const [ex, ey] = polar(end, R);
    return `M ${sx} ${sy} A ${R} ${R} 0 0 1 ${ex} ${ey}`;
  });

  const needleAngle = $derived(sweep($needle));
  const targetAngle = $derived(sweep(target));

  function onRange(e) {
    if (!editable) return;
    app.panel.tilt = +e.currentTarget.value;
  }
</script>

<div class="gauge glass tall" class:locked>
  <div class="row between">
    <div>
      <p class="eyebrow">Cosine incidence efficiency</p>
      <h3 style="font-size:1rem; margin-top:.1rem;">η = cos θ</h3>
    </div>
    <span class="chip" class:ok={efficiency > 0.99} class:warn={efficiency <= 0.99 && efficiency > 0.9}>
      {efficiency > 0.999 ? 'PERFECT LOCK' : efficiency > 0.95 ? 'NEAR LOCK' : efficiency > 0.8 ? 'GOOD' : 'OFF-AXIS'}
    </span>
  </div>

  <svg viewBox="0 0 300 190" class="dial" role="img" aria-label="Panel tilt gauge">
    <defs>
      <linearGradient id="gaugeArc" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#8B5CF6" />
        <stop offset="34%" stop-color="#06B6D4" />
        <stop offset="68%" stop-color="#10B981" />
        <stop offset="100%" stop-color="#F59E0B" />
      </linearGradient>
      <radialGradient id="gaugeCore" cx="50%" cy="72%" r="60%">
        <stop offset="0%" stop-color="rgba(6,182,212,.28)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0)" />
      </radialGradient>
      <filter id="needleGlow" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="3" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>

    <circle cx={cx} cy={cy} r="120" fill="url(#gaugeCore)" />

    <!-- arc track -->
    <path d={arcPath} fill="none" stroke="rgba(148,180,220,.16)" stroke-width="10" stroke-linecap="round" />
    <path
      d={arcPath}
      fill="none"
      stroke="url(#gaugeArc)"
      stroke-width="10"
      stroke-linecap="round"
      stroke-dasharray={`${(efficiency * 0.72) * 251} 251`}
      opacity=".9"
    />

    <!-- ticks -->
    {#each ticks as tk}
      <line x1={tk.x1} y1={tk.y1} x2={tk.x2} y2={tk.y2}
        stroke={tk.major ? 'rgba(232,240,251,.62)' : 'rgba(148,180,220,.32)'}
        stroke-width={tk.major ? 1.7 : 1} />
      {#if tk.major}
        <text x={tk.tx} y={tk.ty + 3} text-anchor="middle" fill="rgba(148,180,220,.72)" font-size="8.5" class="mono">{tk.t}</text>
      {/if}
    {/each}

    <!-- target reticle -->
    <g transform={`rotate(${targetAngle} ${cx} ${cy})`} opacity=".95">
      <line x1={cx} y1={cy - R - 12} x2={cx} y2={cy - R + 6} stroke="#10B981" stroke-width="2.4" />
      <circle cx={cx} cy={cy - R - 14} r="3.4" fill="#10B981" />
    </g>

    <!-- needle -->
    <g transform={`rotate(${needleAngle} ${cx} ${cy})`} filter="url(#needleGlow)">
      <line x1={cx} y1={cy + 14} x2={cx} y2={cy - R + 16} stroke="#FDE68A" stroke-width="2.6" stroke-linecap="round" />
      <circle cx={cx} cy={cy - R + 16} r="4.2" fill="#FFF7E0" />
    </g>

    <!-- hub -->
    <circle cx={cx} cy={cy} r="15" fill="rgba(8,14,24,.92)" stroke="rgba(255,255,255,.2)" />
    <circle cx={cx} cy={cy} r="6" fill="url(#gaugeArc)" />

    <!-- lock ring -->
    {#if inLock}
      <circle cx={cx} cy={cy} r={R - 2} fill="none" stroke="#10B981" stroke-width="1.6" opacity=".8">
        <animate attributeName="r" values={`${R - 2};${R + 8};${R - 2}`} dur="1.5s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.85;0;0.85" dur="1.5s" repeatCount="indefinite" />
      </circle>
    {/if}
  </svg>

  <div class="readout">
    <div>
      <p class="stat-label">live tilt</p>
      <p class="numeral display" style="font-size:1.7rem; color: var(--gold)">{live.toFixed(1)}°</p>
    </div>
    <div>
      <p class="stat-label">target</p>
      <p class="numeral display" style="font-size:1.7rem; color: var(--emerald)">{target.toFixed(1)}°</p>
    </div>
    <div>
      <p class="stat-label">offset</p>
      <p class="numeral display" style="font-size:1.7rem;" class:warn={Math.abs(delta) > 0.5}>
        {delta > 0 ? '+' : ''}{delta.toFixed(1)}°
      </p>
    </div>
    <div>
      <p class="stat-label">capture</p>
      <p class="numeral display" style="font-size:1.7rem; color: var(--cyan)">{(efficiency * 100).toFixed(1)}%</p>
    </div>
  </div>

  {#if editable}
    <div class="slider-row">
      <span class="label">Simulated panel tilt</span>
      <input type="range" min="0" max="90" step="0.1" value={live} oninput={onRange} />
      <span class="mono tiny-text">{live.toFixed(1)}°</span>
    </div>
  {/if}

  {#if locked}
    <div class="lock-banner">
      <span class="dot pulse" style="color: var(--emerald)"></span>
      HAPTIC LOCK · within ±0.5°
    </div>
  {/if}
</div>

<style>
  :global(.numeral.warn) {
    color: var(--magenta);
  }

  .gauge {
    display: grid;
    gap: 0.4rem;
    position: relative;
  }

  .gauge.locked {
    box-shadow:
      var(--shadow),
      0 0 0 1px color-mix(in oklab, var(--emerald) 50%, transparent),
      inset 0 1px 1px rgba(255, 255, 255, 0.34);
  }

  .dial {
    width: 100%;
    height: auto;
    display: block;
    overflow: visible;
  }

  .readout {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.3rem;
    padding-top: 0.4rem;
    border-top: 1px solid var(--border);
  }

  .slider-row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 0.5rem;
  }

  .lock-banner {
    position: absolute;
    left: 50%;
    bottom: 0.7rem;
    transform: translateX(-50%);
    display: inline-flex;
    align-items: center;
    gap: 0.34rem;
    padding: 0.24rem 0.6rem;
    border-radius: 999px;
    background: color-mix(in oklab, var(--emerald) 22%, rgba(4, 12, 10, 0.9));
    border: 1px solid color-mix(in oklab, var(--emerald) 55%, transparent);
    color: #d7ffee;
    font-size: 0.6rem;
    font-weight: 720;
    letter-spacing: 0.1em;
    white-space: nowrap;
    animation: lockpop 320ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  @keyframes lockpop {
    from { transform: translateX(-50%) scale(0.86); opacity: 0; }
    to { transform: translateX(-50%) scale(1); opacity: 1; }
  }

  @media (max-width: 420px) {
    .readout { grid-template-columns: repeat(2, 1fr); }
  }
</style>
