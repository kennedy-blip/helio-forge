<script>
  /**
   * Liquid-glass underlay: the raw `liquid_glass.glsl` WebGL2 atmosphere,
   * retinted live from the current solar elevation angle.
   */
  import { onMount } from 'svelte';
  import { createLiquidGlass } from '$lib/webgl/gl.js';
  import { app } from '$lib/state/app.svelte.js';
  import { sunStage, SUN_STAGE_PALETTES as PAL } from '$lib/solar/kernel.js';
  import { sunNow } from '$lib/state/app.svelte.js';

  let canvas = $state(null);
  let engine = null;
  let raf = 0;
  let failed = $state(false);

  const stage = $derived.by(() => {
    const sun = app.timeMode === 'live' ? sunNow() : sunNow();
    return { sun, stage: sunStage(sun.elevation) };
  });

  const tint = $derived(PAL[stage.stage?.key ?? 'noon'] ?? PAL.noon);
  const nightMix = $derived(
    stage.sun.elevation > 0 ? Math.max(0, 1 - stage.sun.elevation / 18) * 0.4 : 1
  );

  const hexToRgb = (hex) => {
    const h = hex.replace('#', '');
    return [
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255
    ];
  };

  const themeColors = $derived.by(() => {
    const base = {
      top: hexToRgb(tint.top),
      mid: hexToRgb(tint.mid),
      horizon: hexToRgb(tint.horizon),
      glow: hexToRgb(tint.glow)
    };
    if (app.theme === 'infrared') {
      return {
        top: hexToRgb('#12051f'),
        mid: hexToRgb('#4c1d95'),
        horizon: hexToRgb('#ec4899'),
        glow: hexToRgb('#f97316')
      };
    }
    if (app.theme === 'frost') {
      return {
        top: hexToRgb('#cfe3f7'),
        mid: hexToRgb('#9fd0ea'),
        horizon: hexToRgb('#fde8b8'),
        glow: hexToRgb('#f8fafc')
      };
    }
    if (app.theme === 'eco') {
      return {
        top: hexToRgb('#04100e'),
        mid: hexToRgb('#08241f'),
        horizon: hexToRgb('#14b8a6'),
        glow: hexToRgb('#10b981')
      };
    }
    return base;
  });

  onMount(() => {
    if (!canvas) return;
    try {
      engine = createLiquidGlass(canvas);
    } catch (err) {
      console.warn('[helio] liquid_glass.glsl failed to compile', err);
      failed = true;
      return;
    }
    if (!engine) {
      failed = true;
      return;
    }

    let dprScale = 1;
    const resize = () => {
      const cap = app.lowGpu || app.theme === 'eco' ? 0.62 : 1;
      dprScale = Math.min(window.devicePixelRatio || 1, 2) * cap;
      engine.resize(dprScale);
    };
    resize();
    window.addEventListener('resize', resize);

    const t0 = performance.now();
    const loop = () => {
      const t = (performance.now() - t0) / 1000;
      engine.draw({
        time: app.lowGpu || app.theme === 'eco' ? t * 0.4 : t,
        sunElevation: stage.sun.elevation,
        sunAzimuth: stage.sun.azimuth,
        quality: app.lowGpu || app.theme === 'eco' ? 0.35 : 1,
        specularX: app.specular.x,
        specularY: app.specular.y,
        nightMix,
        aberration: app.theme === 'infrared' ? 2.6 : 1,
        colors: themeColors
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      engine?.dispose();
      engine = null;
    };
  });
</script>

<canvas
  bind:this={canvas}
  class="underlay"
  class:dim={app.lowGpu}
  aria-hidden="true"
></canvas>

{#if failed}
  <div class="fallback" aria-hidden="true"></div>
{/if}

<style>
  .underlay {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 0;
    pointer-events: none;
    opacity: 0.92;
    transition: opacity 500ms ease;
  }

  .underlay.dim {
    opacity: 0.74;
  }

  .fallback {
    position: fixed;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    background:
      radial-gradient(90% 60% at 70% -10%, rgba(245, 158, 11, 0.34), transparent 60%),
      radial-gradient(80% 70% at 20% 110%, rgba(6, 182, 212, 0.3), transparent 62%),
      linear-gradient(180deg, #071d33, #04101c 55%, #050a12);
  }
</style>
