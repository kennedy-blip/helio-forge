<script>
  /**
   * 24/48-hour State-of-Charge waveform with PV input + load overlay.
   * Highlights the exact predicted blackout hour.
   */
  let { samples = [], blackout = null, height = 190 } = $props();

  const W = 760;
  const H = $derived(height);
  const PAD = { l: 32, r: 10, t: 12, b: 20 };

  const n = $derived(Math.max(1, samples.length - 1));
  const maxPv = $derived(Math.max(0.2, ...samples.map((s) => Math.max(s.pvKw, s.loadKw))));

  const x = (i) => PAD.l + (i / n) * (W - PAD.l - PAD.r);
  const ySoc = (v) => H - PAD.b - (v / 100) * (H - PAD.t - PAD.b);
  const yPow = (v) => H - PAD.b - (v / maxPv) * (H - PAD.t - PAD.b) * 0.55;

  const socLine = $derived(
    samples.map((s, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${ySoc(s.socPct).toFixed(1)}`).join(' ')
  );
  const socArea = $derived(
    `${socLine} L ${x(n)} ${ySoc(0)} L ${x(0)} ${ySoc(0)} Z`
  );
  const pvLine = $derived(
    samples.map((s, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${yPow(s.pvKw).toFixed(1)}`).join(' ')
  );
  const loadLine = $derived(
    samples.map((s, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${yPow(s.loadKw).toFixed(1)}`).join(' ')
  );

  const blackoutX = $derived(blackout ? x(blackout.hour) : null);
</script>

<svg viewBox={`0 0 ${W} ${H}`} class="wave" role="img" aria-label="State of charge waveform">
  <defs>
    <linearGradient id="socFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#10B981" stop-opacity=".42" />
      <stop offset="60%" stop-color="#06B6D4" stop-opacity=".16" />
      <stop offset="100%" stop-color="#EC4899" stop-opacity=".06" />
    </linearGradient>
    <linearGradient id="socStroke" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#22D3EE" />
      <stop offset="100%" stop-color="#10B981" />
    </linearGradient>
  </defs>

  {#each [0, 25, 50, 75, 100] as pct}
    <line x1={PAD.l} y1={ySoc(pct)} x2={W - PAD.r} y2={ySoc(pct)} stroke="rgba(148,180,220,.13)" stroke-width="0.7" />
    <text x={PAD.l - 5} y={ySoc(pct) + 3} text-anchor="end" fill="rgba(148,180,220,.55)" font-size="7.5" class="mono">{pct}</text>
  {/each}

  <!-- midnight separators -->
  {#each samples as s, i}
    {#if s.clock === '00:00' && i > 0}
      <line x1={x(i)} y1={PAD.t} x2={x(i)} y2={H - PAD.b} stroke="rgba(148,180,220,.22)" stroke-dasharray="3 4" />
      <text x={x(i) + 3} y={PAD.t + 8} fill="rgba(148,180,220,.55)" font-size="7" class="mono">day {Math.floor(i / 24) + 1}</text>
    {/if}
  {/each}

  <path d={socArea} fill="url(#socFill)" />
  <path d={socLine} fill="none" stroke="url(#socStroke)" stroke-width="2.1" stroke-linejoin="round" />

  <path d={pvLine} fill="none" stroke="#F59E0B" stroke-width="1.3" opacity=".85" stroke-dasharray="0" />
  <path d={loadLine} fill="none" stroke="#EC4899" stroke-width="1.2" opacity=".7" stroke-dasharray="4 3" />

  {#if blackoutX !== null}
    <line x1={blackoutX} y1={PAD.t} x2={blackoutX} y2={H - PAD.b} stroke="#EC4899" stroke-width="1.6" />
    <circle cx={blackoutX} cy={ySoc(0)} r="4" fill="#EC4899" />
    <g transform={`translate(${Math.min(blackoutX + 6, W - 120)}, ${H - PAD.b - 30})`}>
      <rect width="112" height="22" rx="6" fill="rgba(20,4,14,.92)" stroke="rgba(236,72,153,.6)" />
      <text x="7" y="14" fill="#FBCFE8" font-size="8.5" class="mono">BLACKOUT {blackout.clock}</text>
    </g>
  {/if}

  <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="rgba(148,180,220,.28)" stroke-width="1" />
</svg>

<div class="legend">
  <span><i style="background:linear-gradient(90deg,#22D3EE,#10B981)"></i>State of charge %</span>
  <span><i style="background:#F59E0B"></i>PV charge kW</span>
  <span><i style="background:#EC4899"></i>Load kW</span>
</div>

<style>
  .wave {
    width: 100%;
    height: auto;
    display: block;
  }

  .legend {
    display: flex;
    gap: 0.9rem;
    flex-wrap: wrap;
    margin-top: 0.2rem;
    font-size: 0.63rem;
    color: var(--text-dim);
  }

  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 0.32rem;
  }

  .legend i {
    width: 14px;
    height: 3px;
    border-radius: 2px;
    display: inline-block;
  }
</style>
