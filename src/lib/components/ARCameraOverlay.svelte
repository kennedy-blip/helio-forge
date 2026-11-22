<script>
  /**
   * Live Camera AR Sky Overlay (Nearest-neighbour optical projection).
   *
   * Solar arcs (Jun 21 / equinox / Dec 21) are projected onto the video feed
   * using a simple calibrated pinhole model driven by the device heading and
   * pitch from the Kotlin sensor bridge (or the simulator sliders).
   */
  import { onMount } from 'svelte';
  import { app, toast, haptic, sunNow } from '$lib/state/app.svelte.js';
  import { solsticeArcs, solarDeclination, hourAngleSunrise } from '$lib/solar/kernel.js';

  let video = $state(null);
  let svg = $state(null);
  let stream = null;
  let camState = $state('idle'); // idle | requesting | live | denied | simulator
  let error = $state('');
  let heading = $state(180);
  let pitch = $state(18);
  let fov = $state(74); // horizontal FOV of the phone camera, degrees

  const arcs = $derived(solsticeArcs(app.latitude, app.longitude, { stepMinutes: 15, todayDoy: app.dayOfYear }));
  const sun = $derived(sunNow());
  const declination = $derived(solarDeclination(app.dayOfYear));

  const W = 1000;
  const H = 620;

  /** Project (azimuth, elevation) into screen space for the current camera pose. */
  function project(azimuth, elevation) {
    let dAz = ((azimuth - heading + 540) % 360) - 180; // -180..180 from screen centre
    const dEl = elevation - pitch;
    const pxPerDeg = W / fov;
    return {
      x: W / 2 + dAz * pxPerDeg,
      y: H / 2 - dEl * pxPerDeg,
      offscreen: Math.abs(dAz) > fov * 0.62
    };
  }

  function arcPath(points) {
    const segs = [];
    let current = [];
    for (const p of points) {
      if (!p.up) {
        if (current.length > 1) segs.push(current);
        current = [];
        continue;
      }
      const q = project(p.azimuth, p.elevation);
      if (q.offscreen) {
        if (current.length > 1) segs.push(current);
        current = [];
        continue;
      }
      current.push(`${current.length === 0 ? 'M' : 'L'} ${q.x.toFixed(1)} ${q.y.toFixed(1)}`);
    }
    if (current.length > 1) segs.push(current);
    return segs.map((s) => s.join(' ')).join(' ');
  }

  /** Hourly markers 08:00–18:00 on each arc. */
  function hourMarkers(points) {
    return points.filter((p) => p.minute % 60 === 0 && p.minute >= 8 * 60 && p.minute <= 18 * 60 && p.up)
      .map((p) => ({ ...p, ...project(p.azimuth, p.elevation) }))
      .filter((p) => !p.offscreen);
  }

  const horizonLine = $derived.by(() => {
    // horizon = elevation 0, project a span of azimuths
    const pts = [];
    for (let az = heading - fov; az <= heading + fov; az += 5) {
      const q = project(az, 0);
      pts.push(`${q.x.toFixed(1)} ${q.y.toFixed(1)}`);
    }
    return pts.length ? `M ${pts.join(' L ')}` : '';
  });

  const obstructionProfile = $derived.by(() => {
    if (!app.horizon.length) return '';
    const sorted = [...app.horizon].sort((a, b) => a.azimuth - b.azimuth);
    const pts = [];
    for (let az = Math.floor(heading - fov); az <= heading + fov; az += 4) {
      let elev = 0;
      for (let i = 0; i < sorted.length - 1; i++) {
        if (az >= sorted[i].azimuth && az <= sorted[i + 1].azimuth) {
          const t = (az - sorted[i].azimuth) / (sorted[i + 1].azimuth - sorted[i].azimuth || 1);
          elev = sorted[i].elevation + (sorted[i + 1].elevation - sorted[i].elevation) * t;
          break;
        }
      }
      const q = project(az, elev);
      pts.push([q.x, q.y]);
    }
    if (!pts.length) return { line: '', fill: '' };
    const line = `M ${pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L ')}`;
    const fill = `${line} L ${pts.at(-1)[0].toFixed(1)} ${H} L ${pts[0][0].toFixed(1)} ${H} Z`;
    return { line, fill };
  });

  const sunDot = $derived(project(sun.azimuth, sun.elevation));

  const daylight = $derived.by(() => {
    const h0 = hourAngleSunrise(app.latitude, declination);
    const hours = (2 * h0) / 15;
    return { hours: hours.toFixed(2), sunrise: 12 - h0 / 15, sunset: 12 + h0 / 15 };
  });

  async function startCamera() {
    if (camState === 'live') {
      stopCamera();
      return;
    }
    camState = 'requesting';
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia unavailable');
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      if (video) {
        video.srcObject = stream;
        await video.play();
      }
      camState = 'live';
      app.permissions.camera = true;
      app.permissionStatus.camera = 'WEB ACTIVE';
      toast('Optical sky-dome camera online', 'success');
    } catch (err) {
      camState = 'simulator';
      error = err?.message ?? 'Camera denied';
      app.permissionStatus.camera = 'RESTRICTED';
      toast('Camera blocked — simulated sky active', 'warn');
    }
  }

  function stopCamera() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    camState = 'idle';
    app.permissions.camera = false;
  }

  onMount(() => {
    // DeviceOrientation drives heading/pitch when permission is granted
    const onOrient = (e) => {
      if (typeof e.webkitCompassHeading === 'number') heading = e.webkitCompassHeading;
      else if (typeof e.alpha === 'number') heading = (360 - e.alpha) % 360;
      if (typeof e.beta === 'number') pitch = Math.max(-20, Math.min(85, e.beta));
      app.permissions.orientation = true;
      app.permissionStatus.orientation = 'WEB ACTIVE';
      app.sensorSource = 'WEB ACTIVE';
    };
    window.addEventListener('deviceorientation', onOrient, true);
    return () => {
      window.removeEventListener('deviceorientation', onOrient, true);
      stopCamera();
    };
  });

  async function requestOrientation() {
    /** @type {any} */
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      try {
        const res = await DOE.requestPermission();
        if (res !== 'granted') throw new Error('denied');
        toast('Compass + clinometer authorised', 'success');
      } catch {
        toast('Orientation denied — drag the heading slider', 'warn');
      }
    } else {
      toast('Compass active via web sensors', 'success');
    }
    haptic([10, 30, 10]);
  }
</script>

<div class="ar-wrap glass">
  <div class="viewfinder">
    {#if camState === 'live'}
      <video bind:this={video} playsinline muted class="cam"></video>
    {:else}
      <div class="sim-sky" aria-hidden="true">
        <div class="sim-sun" style={`left:${(sunDot.x / W) * 100}%; top:${(sunDot.y / H) * 100}%`}></div>
        <div class="sim-haze"></div>
      </div>
    {/if}

    <!-- ============================================ GLSL-style AR annotation -->
    <svg viewBox={`0 0 ${W} ${H}`} class="ar-svg" preserveAspectRatio="none" role="img"
      aria-label="Solar path arcs projected over the camera feed">
      <defs>
        <filter id="arGlow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id="obstFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#10B981" stop-opacity=".28" />
          <stop offset="100%" stop-color="#04120f" stop-opacity=".82" />
        </linearGradient>
      </defs>

      <!-- horizon line -->
      <path d={horizonLine} fill="none" stroke="rgba(255,255,255,.34)" stroke-width="1.4" stroke-dasharray="7 6" />

      <!-- scanned obstruction silhouette -->
      {#if obstructionProfile && obstructionProfile.line}
        <path d={obstructionProfile.fill} fill="url(#obstFill)" />
        <path d={obstructionProfile.line} fill="none" stroke="#22D3EE" stroke-width="1.8" filter="url(#arGlow)" />
      {/if}

      <!-- solstice arcs -->
      {#if app.arcVisibility.summer}
        <path d={arcPath(arcs.summer.points)} fill="none" stroke="#F59E0B" stroke-width="2.4" filter="url(#arGlow)" opacity=".95" />
      {/if}
      {#if app.arcVisibility.equinox}
        <path d={arcPath(arcs.equinox.points)} fill="none" stroke="#22D3EE" stroke-width="2.0" filter="url(#arGlow)" opacity=".9" />
      {/if}
      {#if app.arcVisibility.winter}
        <path d={arcPath(arcs.winter.points)} fill="none" stroke="#8B5CF6" stroke-width="2.4" filter="url(#arGlow)" opacity=".95" />
      {/if}
      {#if app.arcVisibility.today}
        <path d={arcPath(arcs.today.points)} fill="none" stroke="#FFFFFF" stroke-width="1.5" stroke-dasharray="6 5" opacity=".85" />
      {/if}

      <!-- hourly markers -->
      {#if app.arcVisibility.summer}
        {#each hourMarkers(arcs.summer.points) as m}
          <circle cx={m.x} cy={m.y} r="4" fill="#F59E0B" stroke="#1a1206" stroke-width="1.2" />
          <text x={m.x + 7} y={m.y - 5} fill="#FDE68A" font-size="12" class="mono">{m.minute / 60}:00</text>
        {/each}
      {/if}
      {#if app.arcVisibility.winter}
        {#each hourMarkers(arcs.winter.points) as m}
          <text x={m.x + 7} y={m.y + 13} fill="#C4B5FD" font-size="11" class="mono">{m.minute / 60}h</text>
        {/each}
      {/if}

      <!-- live sun -->
      {#if !sunDot.offscreen && sun.elevation > -2}
        <circle cx={sunDot.x} cy={sunDot.y} r="15" fill="#FDE68A" opacity=".22" />
        <circle cx={sunDot.x} cy={sunDot.y} r="7.5" fill="#FFF7E0" stroke="#F59E0B" stroke-width="2.2" filter="url(#arGlow)" />
      {/if}

      <!-- reticle -->
      <g opacity=".32">
        <line x1={W / 2 - 30} y1={H / 2} x2={W / 2 - 8} y2={H / 2} stroke="#fff" stroke-width="1.4" />
        <line x1={W / 2 + 8} y1={H / 2} x2={W / 2 + 30} y2={H / 2} stroke="#fff" stroke-width="1.4" />
        <line x1={W / 2} y1={H / 2 - 30} x2={W / 2} y2={H / 2 - 8} stroke="#fff" stroke-width="1.4" />
        <line x1={W / 2} y1={H / 2 + 8} x2={W / 2} y2={H / 2 + 30} stroke="#fff" stroke-width="1.4" />
      </g>

      <!-- compass ribbon -->
      {#each Array.from({ length: 13 }, (_, i) => (Math.round(heading / 15) * 15) - 90 + i * 15) as az}
        {@const norm = ((az % 360) + 360) % 360}
        {@const dx = ((((az - heading + 540) % 360) - 180) / 90) * (W / 2.6)}
        <text x={W / 2 + dx} y={34} text-anchor="middle" fill="rgba(255,255,255,.8)" font-size="14" class="mono"
          opacity={Math.max(0.18, 1 - Math.abs(dx) / (W / 2.2))}>
          {norm === 0 ? 'N' : norm === 90 ? 'E' : norm === 180 ? 'S' : norm === 270 ? 'W' : norm}
        </text>
      {/each}
    </svg>

    {#if camState !== 'live'}
      <div class="sim-badge">
        <span class="dot pulse"></span>
        <span class="tiny-text">SIMULATED SKY · no camera feed</span>
      </div>
    {/if}

    <div class="viewscreen-frame" aria-hidden="true">
      <span class="corner tl"></span><span class="corner tr"></span>
      <span class="corner bl"></span><span class="corner br"></span>
    </div>
  </div>

  <!-- ============================================================ controls -->
  <div class="ar-controls">
    <div class="row" style="flex-wrap: wrap; gap: .45rem;">
      <button class="btn primary tiny" onclick={startCamera}>
        {camState === 'live' ? '■ Stop camera' : camState === 'requesting' ? 'Requesting…' : '◉ Enable camera AR'}
      </button>
      <button class="btn ghost tiny" onclick={requestOrientation}>Calibrate compass</button>
      <div class="row" style="gap:.3rem; margin-left:auto;">
        {#each [['summer', 'Jun 21', '#F59E0B'], ['equinox', 'Equinox', '#22D3EE'], ['winter', 'Dec 21', '#8B5CF6'], ['today', 'Today', '#fff']] as [key, label, color]}
          <button
            class="arc-toggle"
            class:on={app.arcVisibility[key]}
            onclick={() => (app.arcVisibility = { ...app.arcVisibility, [key]: !app.arcVisibility[key] })}
            style={`--c:${color}`}
          >
            <i></i>{label}
          </button>
        {/each}
      </div>
    </div>

    <div class="sliders">
      <label class="slider">
        <span class="row between"><span class="label">Heading</span><span class="mono tiny-text">{heading.toFixed(0)}°</span></span>
        <input type="range" min="0" max="360" step="1" bind:value={heading} />
      </label>
      <label class="slider">
        <span class="row between"><span class="label">Pitch</span><span class="mono tiny-text">{pitch.toFixed(0)}°</span></span>
        <input type="range" min="-20" max="85" step="1" bind:value={pitch} />
      </label>
      <label class="slider">
        <span class="row between"><span class="label">Camera FOV</span><span class="mono tiny-text">{fov}°</span></span>
        <input type="range" min="50" max="110" step="1" bind:value={fov} />
      </label>
    </div>

    <div class="readout-strip">
      <div><span class="stat-label">daylight</span><span class="mono num">{daylight.hours} h</span></div>
      <div><span class="stat-label">sunrise</span><span class="mono num">{Math.floor(daylight.sunrise)}:{String(Math.round((daylight.sunrise % 1) * 60)).padStart(2, '0')}</span></div>
      <div><span class="stat-label">sunset</span><span class="mono num">{Math.floor(daylight.sunset)}:{String(Math.round((daylight.sunset % 1) * 60)).padStart(2, '0')}</span></div>
      <div><span class="stat-label">declination</span><span class="mono num">{declination.toFixed(1)}°</span></div>
      <div><span class="stat-label">arcs</span><span class="mono num">{Object.values(app.arcVisibility).filter(Boolean).length}/4</span></div>
    </div>
  </div>
</div>

<style>
  .ar-wrap {
    padding: 0.55rem;
    display: grid;
    gap: 0.55rem;
  }

  .viewfinder {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 10;
    min-height: 300px;
    border-radius: 18px;
    overflow: hidden;
    background: #04070d;
    isolation: isolate;
  }

  .cam {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    transform: scaleX(-1) scale(1.02);
    filter: saturate(0.94) contrast(1.06);
  }

  .sim-sky {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(180deg, #0a2a4d 0%, #14588a 42%, #4a8fc0 68%, #cbd6c8 88%, #6f7a5e 100%);
    overflow: hidden;
  }

  .sim-sun {
    position: absolute;
    width: 54px;
    height: 54px;
    border-radius: 999px;
    transform: translate(-50%, -50%);
    background: radial-gradient(circle, #fffbe8 18%, #ffe08a 46%, rgba(245, 158, 11, 0.16) 70%, transparent 76%);
    box-shadow: 0 0 68px 26px rgba(253, 224, 138, 0.34);
    transition: left 420ms ease, top 420ms ease;
  }

  .sim-haze {
    position: absolute;
    inset: auto 0 0 0;
    height: 34%;
    background: linear-gradient(180deg, transparent, rgba(20, 40, 30, 0.5));
    filter: blur(12px);
  }

  .ar-svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .sim-badge {
    position: absolute;
    top: 0.6rem;
    left: 0.6rem;
    display: inline-flex;
    align-items: center;
    gap: 0.34rem;
    padding: 0.24rem 0.55rem;
    border-radius: 999px;
    background: rgba(4, 8, 14, 0.62);
    border: 1px solid rgba(255, 255, 255, 0.16);
    color: #cfe0f5;
    z-index: 3;
  }

  .sim-badge .dot {
    color: var(--gold);
  }

  .viewscreen-frame {
    position: absolute;
    inset: 0.5rem;
    pointer-events: none;
  }

  .corner {
    position: absolute;
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255, 255, 255, 0.54);
  }

  .tl { top: 0; left: 0; border-right: 0; border-bottom: 0; border-radius: 6px 0 0 0; }
  .tr { top: 0; right: 0; border-left: 0; border-bottom: 0; border-radius: 0 6px 0 0; }
  .bl { bottom: 0; left: 0; border-right: 0; border-top: 0; border-radius: 0 0 0 6px; }
  .br { bottom: 0; right: 0; border-left: 0; border-top: 0; border-radius: 0 0 6px 0; }

  .ar-controls {
    display: grid;
    gap: 0.55rem;
  }

  .arc-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.2rem 0.5rem;
    border-radius: 999px;
    font-size: 0.63rem;
    font-weight: 630;
    border: 1px solid var(--border);
    color: var(--text-faint);
    transition: all 200ms ease;
  }

  .arc-toggle i {
    width: 13px;
    height: 3px;
    border-radius: 2px;
    background: var(--c);
    box-shadow: 0 0 7px var(--c);
    opacity: 0.32;
    transition: opacity 200ms ease;
  }

  .arc-toggle.on {
    color: var(--text);
    border-color: color-mix(in oklab, var(--cyan) 40%, transparent);
    background: color-mix(in oklab, var(--cyan) 10%, transparent);
  }

  .arc-toggle.on i {
    opacity: 1;
  }

  .sliders {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 0.3rem 0.8rem;
  }

  .slider {
    display: grid;
    gap: 0.05rem;
  }

  .readout-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 1.05rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border);
  }

  .readout-strip > div {
    display: grid;
    gap: 0.02rem;
    line-height: 1.15;
  }

  .readout-strip .num {
    font-size: 0.82rem;
    font-weight: 640;
  }
</style>
