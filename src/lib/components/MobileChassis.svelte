<script>
  /**
   * Mobile Field APK Preview: a phone chassis that wraps the live app in the
   * desktop "Mobile APK" viewport mode, or renders edge-to-edge on a real phone.
   */
  import { app } from '$lib/state/app.svelte.js';
  import Header from '$lib/components/Header.svelte';
  import MetaballDock from '$lib/components/MetaballDock.svelte';
  import { sunNow } from '$lib/state/app.svelte.js';
  import { sunStage } from '$lib/solar/kernel.js';

  let { children } = $props();

  const isRealPhone = $derived(
    typeof window !== 'undefined' &&
      window.matchMedia('(pointer: coarse)').matches &&
      window.innerWidth < 900
  );

  const sun = $derived(sunNow());
  const stage = $derived(sunStage(sun.elevation));
</script>

{#if isRealPhone}
  <div class="edge">
    <div class="edge-body">
      <Header />
      <main class="edge-main">{@render children()}</main>
      <MetaballDock />
    </div>
  </div>
{:else}
  <div class="chassis-stage">
    <div class="chassis-note">
      <p class="eyebrow">Mobile Field APK Preview</p>
      <p class="tiny-text faint">This is the exact edge-to-edge layout that ships inside the Android WebView.</p>
      <button class="btn ghost tiny" onclick={() => (app.viewport = 'desktop')}>← Back to desktop station</button>
    </div>

    <div class="phone">
      <div class="notch" aria-hidden="true"></div>
      <div class="status" aria-hidden="true">
        <span class="mono tiny-text">{app.permissions.geolocation ? 'GPS' : 'PRESET'}</span>
        <span class="mono tiny-text">{stage.label.split('·')[0]}</span>
        <span class="mono tiny-text">▮▮▮ 84%</span>
      </div>
      <div class="phone-body">
        <Header />
        <main class="phone-main">{@render children()}</main>
        <MetaballDock />
      </div>
      <div class="home-bar" aria-hidden="true"></div>
    </div>
  </div>
{/if}

<style>
  .edge {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
  }

  /* anchor the fixed nav + dock to the app column, not the whole viewport */
  .edge-body {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 100dvh;
  }

  .edge-body :global(.dock) {
    position: absolute;
    left: 50%;
    right: auto;
    width: calc(100% - 1.2rem);
  }

  .edge-main {
    flex: 1;
    width: 100%;
    padding: 0 0.8rem 120px;
  }

  .chassis-stage {
    display: grid;
    justify-items: center;
    gap: 0.9rem;
    padding: 1.2rem 1rem 6rem;
    min-height: 100dvh;
  }

  .chassis-note {
    display: grid;
    justify-items: center;
    gap: 0.3rem;
    text-align: center;
  }

  .phone {
    position: relative;
    width: min(400px, 100%);
    height: min(820px, calc(100dvh - 150px));
    border-radius: 44px;
    padding: 11px;
    background: linear-gradient(160deg, #1a2230, #0a0e16 45%, #05080e);
    box-shadow:
      0 0 0 1.5px rgba(255, 255, 255, 0.13),
      0 0 0 7px rgba(10, 14, 22, 0.9),
      0 44px 100px -34px rgba(0, 0, 0, 0.95),
      0 0 90px -34px rgba(6, 182, 212, 0.6);
    overflow: hidden;
  }

  .notch {
    position: absolute;
    top: 15px;
    left: 50%;
    transform: translateX(-50%);
    width: 92px;
    height: 20px;
    border-radius: 999px;
    background: #02040a;
    z-index: 30;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.07);
  }

  .status {
    position: absolute;
    top: 17px;
    left: 26px;
    right: 26px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    z-index: 29;
    color: rgba(232, 240, 251, 0.72);
    pointer-events: none;
  }

  .phone-body {
    position: relative;
    height: 100%;
    border-radius: 34px;
    overflow-y: auto;
    overflow-x: hidden;
    background: var(--bg-deep);
    scrollbar-width: none;
  }

  .phone-body::-webkit-scrollbar { display: none; }

  .phone-main {
    padding: 0 0.6rem 118px;
  }

  .home-bar {
    position: absolute;
    bottom: 8px;
    left: 50%;
    transform: translateX(-50%);
    width: 118px;
    height: 4px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.4);
    z-index: 40;
    pointer-events: none;
  }

  /* the dock is position:fixed — pin it inside the chassis */
  .phone-body :global(.dock) {
    position: absolute;
    bottom: 0.7rem;
    width: calc(100% - 1.1rem);
  }

  .phone-body :global(.nav) {
    position: sticky;
    top: 0;
  }

  @media (max-width: 720px) {
    .chassis-stage { padding: 0.6rem 0.4rem 5rem; }
    .phone { height: calc(100dvh - 120px); border-radius: 34px; padding: 8px; }
    .phone-body { border-radius: 27px; }
  }
</style>
