<script>
  /**
   * Gooey "Metaball" navigation dock.
   * An inline SVG feGaussianBlur + feColorMatrix contrast filter melts the active
   * indicator into the pill like molten mercury / gold.
   */
  import { app, openModal, currentRole } from '$lib/state/app.svelte.js';

  export const MODULES = [
    { id: 'heliodon', label: 'Heliodon', icon: 'sun', feature: 'ar-heliodon' },
    { id: 'clinometer', label: 'Tilt Clinometer', icon: 'angle', feature: 'clinometer' },
    { id: 'battery', label: 'Battery Forge', icon: 'battery', feature: 'autonomy' },
    { id: 'auditor', label: 'Quote Auditor', icon: 'shield', feature: 'quote' },
    { id: 'vault', label: 'Site Vault', icon: 'vault', feature: 'vault' }
  ];

  const idx = $derived(Math.max(0, MODULES.findIndex((m) => m.id === app.activeModule)));
  const role = $derived(currentRole());

  function go(id) {
    app.activeModule = id;
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(8); } catch { /* ignore */ }
    }
  }
</script>

<svg class="goo-defs" aria-hidden="true">
  <defs>
    <filter id="helio-goo">
      <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur" />
      <feColorMatrix
        in="blur"
        mode="matrix"
        values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -11"
        result="goo"
      />
      <feColorMatrix in="SourceGraphic" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -8" result="sharp" />
      <feBlend in="goo" in2="sharp" mode="normal" />
    </filter>
    <linearGradient id="goo-gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#FDE68A" />
      <stop offset="46%" stop-color="#F59E0B" />
      <stop offset="100%" stop-color="#06B6D4" />
    </linearGradient>
  </defs>
</svg>

<nav class="dock" aria-label="Helio-Forge modules">
  <div class="dock-inner glass">
    <div class="goo-layer" aria-hidden="true">
      <span
        class="blob"
        style={`--i:${idx}; --count:${MODULES.length}`}
      ></span>
    </div>

    {#each MODULES as m}
      <button
        class="dock-btn"
        class:active={app.activeModule === m.id}
        onclick={() => go(m.id)}
        aria-current={app.activeModule === m.id ? 'page' : undefined}
        title={m.label}
      >
        <span class="icon">
          {#if m.icon === 'sun'}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
              <circle cx="12" cy="12" r="4.2" />
              <path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.2 5.2l1.7 1.7M17.1 17.1l1.7 1.7M18.8 5.2l-1.7 1.7M6.9 17.1l-1.7 1.7" />
            </svg>
          {:else if m.icon === 'angle'}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
              <path d="M3 20h18M3 20 19 5" />
              <path d="M3 14a6 6 0 0 1 6 6" opacity=".65" />
              <circle cx="19" cy="5" r="1.6" fill="currentColor" stroke="none" />
            </svg>
          {:else if m.icon === 'battery'}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
              <rect x="2" y="7" width="16" height="10" rx="2.6" />
              <path d="M21 10.4v3.2" stroke-linecap="round" />
              <path d="M6.4 10.2v3.6M9.8 10.2v3.6M13.2 10.2v3.6" opacity=".7" />
            </svg>
          {:else if m.icon === 'shield'}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
              <path d="M12 3 20 6v6.4c0 4.3-3.2 7.4-8 8.6-4.8-1.2-8-4.3-8-8.6V6z" />
              <path d="M8.7 12.2 11 14.5l4.4-4.6" />
            </svg>
          {:else}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
              <ellipse cx="12" cy="6" rx="8" ry="3" />
              <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
              <path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
            </svg>
          {/if}
        </span>
        <span class="txt">{m.label}</span>
        {#if !role.unlocks.includes(m.feature)}
          <span class="lock" aria-label="locked for current tier">🔒</span>
        {/if}
      </button>
    {/each}

    <span class="sep" aria-hidden="true"></span>

    <button class="dock-btn apk-dock" onclick={() => openModal('apk')} title="Download Android APK">
      <span class="icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
          <path d="M12 3.5v11m0 0 4-4m-4 4-4-4M4.5 20h15" stroke-linecap="round" />
        </svg>
      </span>
      <span class="txt">Get .APK</span>
    </button>
  </div>
</nav>

<style>
  .goo-defs {
    position: absolute;
    width: 0;
    height: 0;
    overflow: hidden;
  }

  .dock {
    position: fixed;
    z-index: 90;
    left: 50%;
    bottom: max(0.9rem, env(safe-area-inset-bottom, 0px));
    transform: translateX(-50%);
    width: min(720px, calc(100vw - 1.6rem));
    pointer-events: none;
  }

  .dock-inner {
    position: relative;
    display: flex;
    align-items: stretch;
    gap: 0.1rem;
    padding: 0.34rem;
    border-radius: 24px;
    pointer-events: auto;
    filter: url(#helio-goo);
    background: color-mix(in oklab, var(--surface-solid) 82%, transparent);
    backdrop-filter: blur(22px) saturate(160%);
    -webkit-backdrop-filter: blur(22px) saturate(160%);
  }

  :global([data-gpu='eco']) .dock-inner {
    filter: none;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  .goo-layer {
    position: absolute;
    inset: 0.34rem;
    pointer-events: none;
    overflow: hidden;
    border-radius: 20px;
  }

  /* the molten active indicator */
  .blob {
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc(var(--i) * (100% / var(--count)));
    width: calc(100% / var(--count));
    border-radius: 17px;
    background: linear-gradient(135deg, #FDE68A, #F59E0B 42%, #06B6D4);
    transition: left 560ms cubic-bezier(0.34, 1.42, 0.48, 1);
    box-shadow: 0 0 26px -4px color-mix(in oklab, var(--gold) 80%, transparent);
    opacity: 0.92;
  }

  /* two satellite metaballs that stretch the goo between positions */
  .blob::before,
  .blob::after {
    content: '';
    position: absolute;
    inset: 12% 26%;
    border-radius: 999px;
    background: inherit;
    filter: blur(2px);
    opacity: 0.7;
  }

  .blob::before {
    left: -34%;
  }

  .blob::after {
    right: -34%;
  }

  .dock-btn {
    position: relative;
    z-index: 2;
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.18rem;
    padding: 0.42rem 0.3rem;
    border-radius: 16px;
    color: var(--text-dim);
    transition: color 220ms ease, transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
    min-width: 0;
  }

  .dock-btn .icon {
    display: grid;
    place-items: center;
  }

  .dock-btn svg {
    width: 19px;
    height: 19px;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .dock-btn .txt {
    font-size: 0.625rem;
    font-weight: 640;
    letter-spacing: 0.02em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .dock-btn:hover {
    color: var(--text);
    transform: translateY(-1.5px);
  }

  .dock-btn.active {
    color: #180d00;
  }

  .dock-btn.active .txt {
    font-weight: 780;
  }

  .lock {
    position: absolute;
    top: 2px;
    right: 4px;
    font-size: 0.52rem;
    filter: grayscale(1);
    opacity: 0.7;
  }

  .sep {
    width: 1px;
    margin: 0.4rem 0.1rem;
    background: var(--border);
    z-index: 2;
  }

  .apk-dock {
    flex: 0 0 auto;
    padding-inline: 0.65rem;
    color: color-mix(in oklab, var(--emerald) 88%, white);
  }

  .apk-dock:hover {
    color: #fff;
  }

  @media (max-width: 560px) {
    .dock-btn .txt {
      font-size: 0.56rem;
    }
    .dock-btn svg {
      width: 17px;
      height: 17px;
    }
    .apk-dock .txt {
      display: none;
    }
  }
</style>
