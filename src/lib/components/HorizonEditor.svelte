<script>
  /**
   * Interactive Horizon Shade Obstruction Plotter.
   * Tap/paint on the polar sky chart to add obstruction nodes; the engine
   * immediately reports the Solar Window Efficiency and kWh lost.
   */
  import { app, can, openModal, toast } from '$lib/state/app.svelte.js';
  import { horizonEfficiency, optimalTilt } from '$lib/solar/kernel.js';

  let svgEl = $state(null);
  let painting = $state(false);
  let editing = $state(null);
  let tool = $state('paint'); // paint | erase

  const W = 460;
  const H = 300;
  const cx = W / 2;
  const cy = H - 6;
  const R = 172; // outer radius = horizon line

  const unlocked = $derived(can('horizon-editor'));

  // Polar view: az 0 (south) points straight up, ±90 = east/west horizon
  function projectS(azimuth, elevation) {
    const norm = Math.max(0, Math.min(90, elevation)) / 90;
    const r = R * (1 - norm);
    const theta = (azimuth * Math.PI) / 180; // -180..180
    return [cx + Math.sin(theta) * r, cy - Math.cos(theta) * r];
  }

  const horizonPath = $derived.by(() => {
    if (!app.horizon.length) return '';
    const sorted = [...app.horizon].sort((a, b) => a.azimuth - b.azimuth);
    const pts = [
      { azimuth: -180, elevation: sorted[0].elevation },
      ...sorted,
      { azimuth: 180, elevation: sorted[sorted.length - 1].elevation }
    ];
    const line = pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${projectS(p.azimuth, p.elevation).map((n) => n.toFixed(1)).join(' ')}`)
      .join(' ');
    const base = `L ${projectS(180, 0).map((n) => n.toFixed(1)).join(' ')} L ${projectS(-180, 0).map((n) => n.toFixed(1)).join(' ')} Z`;
    return line + base;
  });

  const efficiency = $derived.by(() =>
    horizonEfficiency(
      app.latitude,
      app.longitude,
      app.horizon,
      optimalTilt(app.latitude, app.dayOfYear, 'fixed'),
      app.panel.azimuth
    )
  );

  function toPolar(e) {
    const rect = svgEl.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    const dx = x - cx;
    const dy = cy - y;
    const r = Math.hypot(dx, dy);
    const norm = Math.max(0, Math.min(1, 1 - r / R));
    const elevation = norm * 90;
    const theta = Math.atan2(dx, dy); // 0 = up
    let azimuth = (theta * 180) / Math.PI;
    if (dy < 0) azimuth = azimuth > 0 ? 180 : -180;
    return { azimuth: Math.round(azimuth), elevation: +elevation.toFixed(1) };
  }

  function addPoint(e) {
    if (!unlocked) {
      toast('Horizon editor is a Pro-tier feature', 'warn');
      return;
    }
    const { azimuth, elevation } = toPolar(e);
    if (elevation > 88) return;
    const existing = app.horizon.find((h) => Math.abs(h.azimuth - azimuth) < 6);
    if (tool === 'erase') {
      app.horizon = app.horizon.filter((h) => Math.abs(h.azimuth - azimuth) >= 12);
      return;
    }
    if (existing) {
      app.horizon = app.horizon.map((h) =>
        Math.abs(h.azimuth - azimuth) < 6 ? { ...h, elevation, azimuth } : h
      );
    } else {
      const label =
        elevation > 25 ? 'Tall obstruction' : elevation > 12 ? 'Tree / roof line' : 'Low ridge';
      app.horizon = [...app.horizon, { azimuth, elevation, label: `${label} @ ${azimuth > 0 ? azimuth + '° SE' : Math.abs(azimuth) + '° SW'}` }];
    }
  }

  function startPaint(e) {
    painting = true;
    addPoint(e);
  }

  function movePaint(e) {
    if (painting) addPoint(e);
  }

  function stopPaint() {
    painting = false;
  }

  function removeNode(i) {
    app.horizon = app.horizon.filter((_, k) => k !== i);
  }

  function applyPreset(kind) {
    const presets = {
      treeline: [
        { azimuth: -155, elevation: 3, label: 'Open field' },
        { azimuth: -110, elevation: 6, label: 'Low hedge' },
        { azimuth: -55, elevation: 14, label: 'Oak canopy' },
        { azimuth: 0, elevation: 9, label: 'South lawn' },
        { azimuth: 60, elevation: 22, label: 'Tall pine' },
        { azimuth: 118, elevation: 16, label: 'Pine cluster' },
        { azimuth: 165, elevation: 5, label: 'Driveway' }
      ],
      urban: [
        { azimuth: -170, elevation: 8, label: 'Street trees' },
        { azimuth: -95, elevation: 18, label: 'Neighbour roof E' },
        { azimuth: -20, elevation: 26, label: '3-storey block' },
        { azimuth: 55, elevation: 21, label: 'Neighbour roof W' },
        { azimuth: 130, elevation: 11, label: 'Garage' },
        { azimuth: 178, elevation: 6, label: 'Front yard' }
      ],
      mountain: [
        { azimuth: -180, elevation: 12, label: 'West ridge' },
        { azimuth: -120, elevation: 19, label: 'Alpine shoulder' },
        { azimuth: -40, elevation: 24, label: 'Summit face' },
        { azimuth: 30, elevation: 14, label: 'Saddle' },
        { azimuth: 100, elevation: 9, label: 'East shoulder' },
        { azimuth: 180, elevation: 11, label: 'Valley wall' }
      ],
      clear: []
    };
    app.horizon = presets[kind] ?? [];
    toast(`Horizon profile → ${kind}`, 'success');
  }

  const starlink = $derived.by(() => {
    // Starlink needs a 100° cone centred on the local zenith: elevation >= 40°
    let blocked = 0;
    let total = 0;
    for (let az = -180; az < 180; az += 10) {
      total++;
      const sorted = [...app.horizon].sort((a, b) => a.azimuth - b.azimuth);
      let elev = 0;
      for (let i = 0; i < sorted.length - 1; i++) {
        if (az >= sorted[i].azimuth && az <= sorted[i + 1].azimuth) {
          const t = (az - sorted[i].azimuth) / (sorted[i + 1].azimuth - sorted[i].azimuth || 1);
          elev = sorted[i].elevation + (sorted[i + 1].elevation - sorted[i].elevation) * t;
        }
      }
      if (elev > 40) blocked++;
    }
    return {
      clear: +(((total - blocked) / total) * 100).toFixed(0),
      cone: 100
    };
  });
</script>

<div class="he-wrap glass tall">
  <div class="row between" style="flex-wrap: wrap; gap:.5rem;">
    <div>
      <p class="eyebrow">Horizon Shade Obstruction Plotter</p>
      <h3 style="font-size:1.02rem; margin-top:.15rem;">Paint your skyline</h3>
    </div>
    <div class="row">
      <div class="seg">
        <button class:active={tool === 'paint'} onclick={() => (tool = 'paint')}>Paint</button>
        <button class:active={tool === 'erase'} onclick={() => (tool = 'erase')}>Erase</button>
      </div>
      <button class="btn ghost tiny" onclick={() => openModal('privileges')}>
        {unlocked ? 'Pro unlocked' : 'Pro feature'}
      </button>
    </div>
  </div>

  <div class="chart-wrap">
    <svg
      bind:this={svgEl}
      viewBox={`0 0 ${W} ${H}`}
      class="chart"
      class:locked={!unlocked}
      onpointerdown={startPaint}
      onpointermove={movePaint}
      onpointerup={stopPaint}
      onpointerleave={stopPaint}
      role="img"
      aria-label="Polar horizon obstruction chart"
    >
      <defs>
        <linearGradient id="obst" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#10B981" stop-opacity=".38" />
          <stop offset="100%" stop-color="#062a24" stop-opacity=".92" />
        </linearGradient>
        <radialGradient id="skyDome" cx="50%" cy="100%" r="100%">
          <stop offset="0%" stop-color="#F59E0B" stop-opacity=".22" />
          <stop offset="45%" stop-color="#06B6D4" stop-opacity=".10" />
          <stop offset="100%" stop-color="#060a14" stop-opacity="0" />
        </radialGradient>
      </defs>

      <!-- sky gradient -->
      <path
        d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy} Z`}
        fill="url(#skyDome)"
      />

      <!-- elevation rings -->
      {#each [15, 30, 45, 60, 75] as el}
        {@const r = R * (1 - el / 90)}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(148,180,220,.18)" stroke-width="0.7" stroke-dasharray={el % 30 === 0 ? '0' : '3 4'} />
        <text x={cx + 4} y={cy - r + 3} fill="rgba(148,180,220,.5)" font-size="7" class="mono">{el}°</text>
      {/each}

      <!-- azimuth spokes -->
      {#each [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150] as az}
        {@const p = projectS(az, 0)}
        <line x1={cx} y1={cy} x2={p[0]} y2={p[1]} stroke="rgba(148,180,220,.13)" stroke-width="0.7" />
        <text
          x={projectS(az, 0)[0]}
          y={cy + (az === 0 ? 12 : 9)}
          text-anchor="middle"
          fill="rgba(148,180,220,.55)"
          font-size="7.5"
          class="mono"
        >{az === 0 ? 'S 0°' : az === -90 ? 'E -90°' : az === 90 ? 'W 90°' : `${az}°`}</text>
      {/each}

      <!-- horizon obstruction fill -->
      {#if horizonPath}
        <path d={horizonPath} fill="url(#obst)" stroke="#22D3EE" stroke-width="1.6" stroke-linejoin="round" />
      {/if}

      <!-- nodes -->
      {#each app.horizon as h, i}
        {@const p = projectS(h.azimuth, h.elevation)}
        <circle cx={p[0]} cy={p[1]} r="3.4" fill="#0b1622" stroke="#22D3EE" stroke-width="1.6" />
      {/each}

      <!-- compass ring -->
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="rgba(34,211,238,.35)" stroke-width="1.1" />
    </svg>

    <div class="starlink-card">
      <p class="stat-label">Starlink FOV check</p>
      <p class="numeral display" style="font-size:1.3rem; color: var(--emerald)">{starlink.clear}%</p>
      <p class="tiny-text faint">100° clear-sky cone · needs α ≥ 40°</p>
    </div>
  </div>

  <div class="row between" style="margin-top:.6rem; flex-wrap:wrap; gap:.4rem;">
    <div class="row" style="flex-wrap:wrap; gap:.3rem;">
      <button class="btn ghost tiny" onclick={() => applyPreset('treeline')}>Treeline</button>
      <button class="btn ghost tiny" onclick={() => applyPreset('urban')}>Urban roof</button>
      <button class="btn ghost tiny" onclick={() => applyPreset('mountain')}>Mountain</button>
      <button class="btn ghost tiny" onclick={() => applyPreset('clear')}>Clear sky</button>
    </div>
    <span class="chip" class:ok={efficiency.solarWindowEfficiency > 85} class:warn={efficiency.solarWindowEfficiency <= 85 && efficiency.solarWindowEfficiency > 60}>
      window efficiency {efficiency.solarWindowEfficiency}%
    </span>
  </div>

  <div class="grid cols-3" style="margin-top:.7rem;">
    <div class="metric">
      <p class="stat-label">Energy lost</p>
      <p class="numeral stat-value" style="color: var(--magenta)">−{efficiency.lostKwhM2.toFixed(0)}</p>
      <p class="tiny-text faint">kWh/m² per year</p>
    </div>
    <div class="metric">
      <p class="stat-label">Shaded yield</p>
      <p class="numeral stat-value">{efficiency.shadedKwhM2.toFixed(0)}</p>
      <p class="tiny-text faint">kWh/m² per year</p>
    </div>
    <div class="metric">
      <p class="stat-label">Obstruction nodes</p>
      <p class="numeral stat-value">{app.horizon.length}</p>
      <p class="tiny-text faint">tap chart to {tool === 'erase' ? 'remove' : 'add'}</p>
    </div>
  </div>
</div>

<style>
  .chart-wrap {
    position: relative;
    margin-top: 0.6rem;
  }

  .chart {
    width: 100%;
    height: auto;
    display: block;
    border-radius: 16px;
    background: radial-gradient(120% 100% at 50% 100%, rgba(6, 182, 212, 0.08), rgba(4, 8, 14, 0.6));
    border: 1px solid var(--border);
    cursor: crosshair;
    touch-action: none;
  }

  .chart.locked {
    cursor: not-allowed;
    opacity: 0.9;
  }

  .starlink-card {
    position: absolute;
    top: 0.6rem;
    right: 0.6rem;
    padding: 0.42rem 0.62rem;
    border-radius: 12px;
    background: rgba(4, 8, 14, 0.62);
    border: 1px solid rgba(255, 255, 255, 0.12);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    text-align: right;
  }

  .metric {
    padding: 0.5rem 0.6rem;
    border-radius: 12px;
    background: color-mix(in oklab, var(--surface-solid) 50%, transparent);
    border: 1px solid var(--border);
  }

  .metric .stat-value {
    font-size: 1.25rem;
  }
</style>
