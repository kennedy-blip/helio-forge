<script>
  /**
   * Interactive 3D WebGL2 GLSL Heliodon Dome.
   * Drag to orbit, wheel to zoom, live solar arcs from the ephemeris engine.
   */
  import { onMount } from 'svelte';
  import { createHeliodon, hasWebGL2, sunVector } from '$lib/webgl/gl.js';
  import { app } from '$lib/state/app.svelte.js';
  import { solsticeArcs, sunStage, SUN_STAGE_PALETTES, cosineEfficiency } from '$lib/solar/kernel.js';
  import { sunNow } from '$lib/state/app.svelte.js';

  let canvas = $state(null);
  let engine = null;
  let raf = 0;
  let failed = $state(false);
  let dragging = $state(false);
  let last = { x: 0, y: 0 };

  const sun = $derived(sunNow());
  const arcs = $derived(
    solsticeArcs(app.latitude, app.longitude, { stepMinutes: 20, todayDoy: app.dayOfYear })
  );

  const hexToRgb = (hex) => {
    const h = hex.replace('#', '');
    return [
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255
    ];
  };

  const tint = $derived.by(() => {
    const pal = SUN_STAGE_PALETTES[sunStage(sun.elevation).key] ?? SUN_STAGE_PALETTES.noon;
    if (app.theme === 'infrared') {
      return { glow: hexToRgb('#f97316'), sky: hexToRgb('#1c0b30'), rim: hexToRgb('#ec4899') };
    }
    if (app.theme === 'frost') {
      return { glow: hexToRgb('#f59e0b'), sky: hexToRgb('#bfdcf2'), rim: hexToRgb('#0369a1') };
    }
    if (app.theme === 'eco') {
      return { glow: hexToRgb('#14b8a6'), sky: hexToRgb('#04120f'), rim: hexToRgb('#10b981') };
    }
    return { glow: hexToRgb(pal.horizon), sky: hexToRgb(pal.top), rim: hexToRgb(pal.glow) };
  });

  onMount(() => {
    if (!canvas) return;
    if (!hasWebGL2()) {
      failed = true;
      return;
    }
    try {
      engine = createHeliodon(canvas);
    } catch (err) {
      console.warn('[helio] heliodon.glsl failed', err);
      failed = true;
      return;
    }
    if (!engine) {
      failed = true;
      return;
    }

    const resize = () => {
      const cap = app.lowGpu || app.theme === 'eco' ? 0.7 : Math.min(window.devicePixelRatio || 1, 2);
      engine.resize(cap);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const t0 = performance.now();
    const loop = () => {
      if (engine) {
        engine.draw({
          time: (performance.now() - t0) / 1000,
          sunAzimuth: sun.azimuth,
          sunElevation: sun.elevation,
          panelTilt: app.panel.tilt,
          panelAzimuth: app.panel.azimuth,
          quality: app.lowGpu || app.theme === 'eco' ? 0.5 : 1,
          specularX: app.specular.x,
          specularY: app.specular.y,
          showGrid: app.showGrid,
          showObstruction: app.showObstruction,
          hasHorizon: app.horizon.length > 0,
          tiltLine: app.showTiltRing ? app.panel.tilt : 0,
          arcCount: 48,
          ...tint
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    loadScene();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      engine?.dispose();
      engine = null;
    };
  });

  // keep the GPU arc/horizon banks in sync with reactive state
  let loadedSite = '';
  function loadScene() {
    if (!engine) return;
    engine.loadArcs(arcs);
    engine.loadHorizon(app.horizon);
    loadedSite = `${app.latitude},${app.longitude}`;
  }

  $effect(() => {
    // re-upload arcs whenever the site changes
    void app.latitude;
    void app.longitude;
    if (engine) {
      engine.loadArcs(arcs);
      loadScene();
    }
  });

  $effect(() => {
    void app.horizon;
    if (engine) engine.loadHorizon(app.horizon);
  });

  function onPointerDown(e) {
    dragging = true;
    last = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e) {
    if (!dragging || !engine) return;
    engine.orbit(e.clientX - last.x, e.clientY - last.y);
    last = { x: e.clientX, y: e.clientY };
  }

  function onPointerUp() {
    dragging = false;
  }

  function onWheel(e) {
    e.preventDefault();
    engine?.zoom(e.deltaY);
  }

  const efficiency = $derived(
    cosineEfficiency(sun.elevation, sun.azimuth, app.panel.tilt, app.panel.azimuth)
  );
</script>

<div class="dome-shell glass">
  <canvas
    bind:this={canvas}
    class="dome-canvas"
    class:grabbing={dragging}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onpointerleave={onPointerUp}
    onwheel={onWheel}
    aria-label="Interactive 3D solar dome showing solstice arcs and live sun position"
    tabindex="0"
  ></canvas>

  {#if failed}
    <div class="dome-fallback">
      <p class="eyebrow">WebGL2 unavailable</p>
      <p class="small muted">The 3D heliodon needs a WebGL2 context. The AR camera overlay and the
        numeric readouts below remain fully functional.</p>
    </div>
  {/if}

  <!-- HUD overlays -->
  <div class="hud top-left">
    <span class="chip solid"><span class="dot"></span> LIVE DOME</span>
    <span class="mono tiny-text faint">drag to orbit · scroll to zoom</span>
  </div>

  <div class="hud top-right">
    <div class="legend">
      <span><i style="background:#F59E0B"></i>Jun 21</span>
      <span><i style="background:#22D3EE"></i>Mar/Sep 21</span>
      <span><i style="background:#8B5CF6"></i>Dec 21</span>
      <span><i style="background:#FFFFFF"></i>Today</span>
    </div>
  </div>

  <div class="hud bottom-left">
    <div class="sun-readout">
      <div>
        <p class="stat-label">elevation α</p>
        <p class="numeral display" style="font-size: 1.6rem; color: var(--gold)">
          {sun.elevation.toFixed(1)}°
        </p>
      </div>
      <div>
        <p class="stat-label">azimuth</p>
        <p class="numeral display" style="font-size: 1.6rem;">{sun.azimuth.toFixed(0)}°</p>
      </div>
      <div>
        <p class="stat-label">cos θ</p>
        <p class="numeral display" style="font-size: 1.6rem; color: var(--emerald)">
          {(efficiency * 100).toFixed(1)}%
        </p>
      </div>
    </div>
  </div>

  <div class="hud bottom-right">
    <span class="chip" class:ok={app.horizon.length > 0}>
      {app.horizon.length ? `${app.horizon.length} horizon nodes` : 'no horizon scan'}
    </span>
  </div>
</div>

<style>
  .dome-shell {
    position: relative;
    aspect-ratio: 16 / 11;
    min-height: 340px;
    overflow: hidden;
    border-radius: 24px;
    background: radial-gradient(80% 70% at 50% 0%, #0b2340, #050810 78%);
  }

  .dome-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    cursor: grab;
    touch-action: none;
  }

  .dome-canvas.grabbing {
    cursor: grabbing;
  }

  .dome-fallback {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    gap: 0.4rem;
    padding: 2rem;
    text-align: center;
  }

  .hud {
    position: absolute;
    pointer-events: none;
    display: flex;
    gap: 0.4rem;
    align-items: center;
    z-index: 3;
  }

  .top-left {
    top: 0.8rem;
    left: 0.9rem;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
  }

  .top-right {
    top: 0.8rem;
    right: 0.9rem;
  }

  .bottom-left {
    bottom: 0.8rem;
    left: 0.9rem;
  }

  .bottom-right {
    bottom: 0.8rem;
    right: 0.9rem;
  }

  .legend {
    display: grid;
    gap: 0.18rem;
    padding: 0.42rem 0.6rem;
    border-radius: 11px;
    background: rgba(4, 8, 14, 0.52);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    font-size: 0.6rem;
    color: #cfe0f5;
  }

  .legend span {
    display: flex;
    align-items: center;
    gap: 0.34rem;
    white-space: nowrap;
  }

  .legend i {
    width: 12px;
    height: 2.5px;
    border-radius: 2px;
    box-shadow: 0 0 7px currentColor;
  }

  .sun-readout {
    display: flex;
    gap: 1.15rem;
    padding: 0.5rem 0.85rem;
    border-radius: 14px;
    background: rgba(4, 8, 14, 0.5);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #eaf3ff;
  }

  @media (max-width: 700px) {
    .dome-shell {
      aspect-ratio: 4 / 3.4;
      min-height: 300px;
    }
    .top-right {
      display: none;
    }
    .sun-readout {
      gap: 0.7rem;
      padding: 0.4rem 0.6rem;
    }
  }
</style>
