<script>
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import '$lib/styles/glass.css';
  import { app } from '$lib/state/app.svelte.js';
  import { THEME_VARS } from '$lib/state/theme.svelte.js';
  import { initVault } from '$lib/db/vault.js';
  import { hasWebGL2 } from '$lib/webgl/gl.js';
  import AtmosphericUnderlay from '$lib/components/AtmosphericUnderlay.svelte';
  import NoiseOverlay from '$lib/components/NoiseOverlay.svelte';
  import ToastStack from '$lib/components/ToastStack.svelte';
  import ModalHost from '$lib/components/ModalHost.svelte';
  import Header from '$lib/components/Header.svelte';
  import MetaballDock from '$lib/components/MetaballDock.svelte';
  import MobileChassis from '$lib/components/MobileChassis.svelte';

  let { children } = $props();

  let glOk = $state(true);

  onMount(() => {
    initVault();
    glOk = hasWebGL2();
    if (!glOk) app.lowGpu = true;

    // device-class detection: phones/tablets boot straight into field mode
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const narrow = window.innerWidth < 900;
    if (coarse && narrow) app.viewport = 'mobile';

    // reduced-motion or save-data users get the low-GPU path by default
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) app.lowGpu = true;

    const t = setTimeout(() => {
      app.booted = true;
    }, 620);
    return () => clearTimeout(t);
  });

  // Global cursor → specular vector (desktop) — drives the glass highlights
  /** @param {any} e */
  function onPointer(e) {
    if (e.pointerType === 'touch') return;
    app.specular.x = (e.clientX / window.innerWidth) * 2 - 1;
    app.specular.y = -((e.clientY / window.innerHeight) * 2 - 1);
  }

  const vars = $derived(THEME_VARS[app.theme] ?? THEME_VARS.obsidian);
  const varStyle = $derived(
    Object.entries(vars)
      .map(([k, v]) => `${k}:${v}`)
      .join(';')
  );
  const gpuMode = $derived(app.lowGpu || app.theme === 'eco' ? 'eco' : 'full');
</script>

<svelte:window on:pointermove={onPointer} />

<svelte:head>
  <title>HELIO-FORGE · Optical AR Solar Heliodon & Off-Grid Solar Engineering</title>
  <meta
    name="description"
    content="HELIO-FORGE — AR solar-path heliodon, horizon shade scanner, photovoltaic tilt optimizer and off-grid battery autonomy architect. Svelte 5 + Python 3.12 + WebGL2 GLSL + Kotlin."
  />
  <meta name="theme-color" content="#070a12" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="apple-touch-icon" href="/icon.svg" />
  <link rel="icon" href="/icon.svg" type="image/svg+xml" />
</svelte:head>

<div class="app-root" data-theme={app.theme} data-gpu={gpuMode} style={varStyle}>
  <AtmosphericUnderlay />

  <div class="shell" class:depth-push={app.modal}>
    {#if app.viewport === 'mobile'}
      <MobileChassis>
        {@render children()}
      </MobileChassis>
    {:else}
      <div class="stage">
        <Header />
        <main class="wrap" style="padding-top: .4rem;">
          {@render children()}
        </main>
      </div>
      <MetaballDock />
    {/if}
  </div>

  <NoiseOverlay />
  <ModalHost />
  <ToastStack />

  {#if !app.booted}
    <div class="boot-curtain" transition:fade={{ duration: 380 }}>
      <div class="boot-mark">
        <div class="boot-orb"></div>
        <div class="mono tiny-text" style="letter-spacing:.35em; opacity:.7">HELIO-FORGE</div>
        <div class="faint tiny-text">spinning up solar kernel…</div>
      </div>
    </div>
  {/if}
</div>

<style>
  .app-root {
    --sidebar-w: 232px;
    position: relative;
    min-height: 100dvh;
    background:
      radial-gradient(120% 80% at 78% -12%, var(--glow-a), transparent 62%),
      radial-gradient(95% 70% at 8% 108%, var(--glow-b), transparent 58%),
      var(--bg);
    color: var(--text);
    overflow-x: clip;
    transition: background 620ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .shell {
    position: relative;
    z-index: 10;
    transform-origin: 50% 22%;
    transition: transform 520ms cubic-bezier(0.22, 1, 0.36, 1),
      filter 520ms cubic-bezier(0.22, 1, 0.36, 1), border-radius 520ms ease;
    will-change: transform;
  }

  /* "Depth Push" modal backdrop */
  .shell.depth-push {
    transform: scale(0.94);
    filter: blur(7px) saturate(0.82) brightness(0.76);
    border-radius: 28px;
    overflow: hidden;
  }

  .boot-curtain {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: grid;
    place-items: center;
    background: var(--bg-deep);
  }

  .boot-mark {
    display: grid;
    justify-items: center;
    gap: 0.7rem;
  }

  .boot-orb {
    width: 62px;
    height: 62px;
    border-radius: 999px;
    background: conic-gradient(from 0deg, var(--gold), var(--cyan), var(--emerald), var(--gold));
    filter: blur(0.5px);
    animation: spin 2.4s linear infinite;
    mask: radial-gradient(circle, transparent 42%, #000 44%);
    -webkit-mask: radial-gradient(circle, transparent 42%, #000 44%);
    box-shadow: 0 0 44px -6px var(--gold);
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
