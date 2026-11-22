<script>
  import { THEMES, THEME_VARS } from '$lib/state/theme.svelte.js';
  import { app, openModal, setRole, currentRole, sunNow, toast } from '$lib/state/app.svelte.js';
  import { sunStage } from '$lib/solar/kernel.js';

  let themeOpen = $state(false);
  let roleOpen = $state(false);

  const sun = $derived(sunNow());
  const stage = $derived(sunStage(sun.elevation));
  const role = $derived(currentRole());
  const clock = $derived.by(() => {
    const m = app.timeMode === 'live' ? app.minuteOfDay : app.scrubHour * 60;
    const hh = Math.floor(((m + app.timezoneOffset * 60) % 1440 + 1440) % 1440 / 60);
    const mm = Math.round(m + app.timezoneOffset * 60) % 60;
    return `${String(hh).padStart(2, '0')}:${String(Math.abs(mm)).padStart(2, '0')}`;
  });

  function pickTheme(id) {
    app.theme = id;
    app.lowGpu = id === 'eco';
    themeOpen = false;
    toast(`Field environment → ${THEMES.find((t) => t.id === id)?.name}`, 'success');
  }

  function setViewport(v) {
    app.viewport = v;
  }
</script>

<header class="nav">
  <div class="wrap row between" style="gap: .8rem;">
    <!-- ============================================================ brand -->
    <a class="brand" href="/" aria-label="HELIO-FORGE home">
      <svg viewBox="0 0 44 44" class="mark" aria-hidden="true">
        <defs>
          <linearGradient id="hg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="var(--gold)" />
            <stop offset="52%" stop-color="var(--cyan)" />
            <stop offset="100%" stop-color="var(--emerald)" />
          </linearGradient>
        </defs>
        <circle cx="22" cy="22" r="20" fill="none" stroke="url(#hg)" stroke-width="1.4" opacity=".8" />
        <path d="M4 30 A 19 19 0 0 1 40 30" fill="none" stroke="url(#hg)" stroke-width="1.2" opacity=".55" />
        <circle cx="22" cy="17" r="5.2" fill="url(#hg)" />
        <path d="M8 34 L36 34" stroke="url(#hg)" stroke-width="1.6" opacity=".7" />
        <path d="M15 30 L29 30" stroke="currentColor" stroke-width="1" opacity=".4" />
      </svg>
      <span class="brand-text">
        <strong class="mono">HELIO<span style="color: var(--gold)">·</span>FORGE</strong>
        <em class="eyebrow">solar optical workstation</em>
      </span>
    </a>

    <!-- ======================================================= live readings -->
    <div class="readouts">
      <div class="readout">
        <span class="stat-label">sun</span>
        <span class="mono num" class:up={sun.elevation > 0}>{sun.elevation.toFixed(1)}°</span>
      </div>
      <div class="readout hide-sm">
        <span class="stat-label">az</span>
        <span class="mono num">{sun.azimuth.toFixed(0)}°</span>
      </div>
      <div class="readout hide-sm">
        <span class="stat-label">clock</span>
        <span class="mono num">{clock}</span>
      </div>
      <div class="stage-chip" title={stage.label}>
        <span class="dot pulse"></span>
        <span class="tiny-text">{stage.label}</span>
      </div>
    </div>

    <div class="spacer"></div>

    <!-- ============================================================== tools -->
    <div class="tools">
      <div class="seg viewport-seg hide-sm">
        <button class:active={app.viewport === 'desktop'} onclick={() => setViewport('desktop')}>
          Desktop Station
        </button>
        <button class:active={app.viewport === 'mobile'} onclick={() => setViewport('mobile')}>
          Mobile APK
        </button>
      </div>

      <!-- theme switcher -->
      <div class="pop-wrap">
        <button class="btn ghost tiny theme-btn" onclick={() => (themeOpen = !themeOpen)} aria-expanded={themeOpen}>
          <span class="swatch" style={`background: linear-gradient(135deg, ${(THEMES.find(t=>t.id===app.theme)?.swatch||[]).join(',')})`}></span>
          <span class="hide-sm">{THEMES.find((t) => t.id === app.theme)?.icon} Field Env</span>
        </button>
        {#if themeOpen}
          <div class="pop glass pad" role="menu">
            <p class="eyebrow" style="margin-bottom: .5rem">Field Environment</p>
            {#each THEMES as t}
              <button class="theme-row" class:sel={app.theme === t.id} onclick={() => pickTheme(t.id)} role="menuitem">
                <span class="swatch-lg" style={`background: linear-gradient(135deg, ${t.swatch.join(',')})`}></span>
                <span class="col">
                  <strong class="small">{t.name}</strong>
                  <span class="tiny-text faint">{t.subtitle}</span>
                </span>
                {#if app.theme === t.id}<span class="chip ok tiny">active</span>{/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <!-- role switcher -->
      <div class="pop-wrap">
        <button class="btn ghost tiny" onclick={() => (roleOpen = !roleOpen)} aria-expanded={roleOpen} title="Role-based access control">
          <span class="dot" style="color: var(--gold)"></span>
          <span class="hide-sm">{role.tier}</span>
          <span class="show-sm mono">RBAC</span>
        </button>
        {#if roleOpen}
          <div class="pop glass pad wide" role="menu">
            <p class="eyebrow" style="margin-bottom: .5rem">Privilege Tier</p>
            {#each ['explorer', 'engineer', 'architect'] as id}
              {@const r = ['explorer', 'engineer', 'architect'].includes(id) ? id : 'explorer'}
              <button
                class="role-row"
                class:sel={app.role === id}
                onclick={() => { setRole(id); roleOpen = false; }}
                role="menuitem"
              >
                <span class="mono tiny-text tier">{(id === 'explorer' ? 'STANDARD' : id === 'engineer' ? 'PRO' : 'ADMIN')}</span>
                <span class="col">
                  <strong class="small">{id === 'explorer' ? 'OFF-GRID EXPLORER / CAMPER' : id === 'engineer' ? 'SOLAR PV ENGINEER' : 'MICROGRID SYSTEMS ARCHITECT'}</strong>
                  <span class="tiny-text faint">{id === 'explorer' ? 'AR Heliodon · Clinometer · Power Station' : id === 'engineer' ? 'Thermal derating · Shade editor · Quote audit · MPPT' : 'Polyglot inspector · GLSL debug · CSV export · Sync'}</span>
                </span>
              </button>
            {/each}
            <div class="divider"></div>
            <button class="btn ghost tiny full" onclick={() => { openModal('privileges'); roleOpen = false; }}>
              Hardware & Runtime Matrix →
            </button>
          </div>
        {/if}
      </div>

      <button class="btn icon ghost" title="Polyglot runtime inspector" onclick={() => openModal('inspector')}>
        <span class="mono" style="font-size:.72rem">{'{ }'}</span>
      </button>

      <button class="btn apk tiny" onclick={() => openModal('apk')}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">
          <path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 20h16" />
        </svg>
        <span class="hide-sm">Download .APK</span>
        <span class="show-sm">.APK</span>
      </button>
    </div>
  </div>
</header>

{#if themeOpen || roleOpen}
  <button class="scrim" aria-label="close menu" onclick={() => { themeOpen = false; roleOpen = false; }}></button>
{/if}

<style>
  .nav {
    position: sticky;
    top: 0;
    z-index: 60;
    padding: 0.62rem 0;
    background: color-mix(in oklab, var(--bg) 70%, transparent);
    backdrop-filter: blur(18px) saturate(150%);
    -webkit-backdrop-filter: blur(18px) saturate(150%);
    border-bottom: 1px solid var(--border);
  }

  :global([data-gpu='eco']) .nav {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    background: var(--surface-solid);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    text-decoration: none;
    color: var(--text);
    flex: none;
  }

  .mark {
    width: 36px;
    height: 36px;
    filter: drop-shadow(0 0 12px color-mix(in oklab, var(--gold) 46%, transparent));
  }

  .brand-text {
    display: grid;
    line-height: 1.1;
  }

  .brand-text strong {
    font-size: 1rem;
    letter-spacing: 0.06em;
  }

  .brand-text em {
    font-style: normal;
    font-size: 0.56rem;
    letter-spacing: 0.24em;
  }

  .readouts {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    padding-left: 0.9rem;
    margin-left: 0.4rem;
    border-left: 1px solid var(--border);
  }

  .readout {
    display: grid;
    gap: 0.05rem;
    line-height: 1;
  }

  .readout .num {
    font-size: 0.86rem;
    font-weight: 640;
  }

  .readout .num.up {
    color: var(--gold);
  }

  .stage-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.36rem;
    padding: 0.24rem 0.6rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: color-mix(in oklab, var(--surface-hi) 70%, transparent);
    color: var(--text-dim);
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tools {
    display: flex;
    align-items: center;
    gap: 0.42rem;
  }

  .swatch {
    width: 12px;
    height: 12px;
    border-radius: 4px;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.4);
  }

  .swatch-lg {
    width: 26px;
    height: 26px;
    border-radius: 8px;
    flex: none;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.42);
  }

  .pop-wrap {
    position: relative;
  }

  .pop {
    position: absolute;
    right: 0;
    top: calc(100% + 0.5rem);
    width: 310px;
    z-index: 70;
    display: grid;
    gap: 0.22rem;
    padding: 0.7rem;
  }

  .pop.wide {
    width: 372px;
  }

  .theme-row,
  .role-row {
    display: flex;
    align-items: center;
    gap: 0.58rem;
    padding: 0.5rem;
    border-radius: 12px;
    text-align: left;
    transition: background 180ms ease;
    width: 100%;
  }

  .theme-row:hover,
  .role-row:hover {
    background: color-mix(in oklab, var(--surface-hi) 70%, transparent);
  }

  .theme-row.sel,
  .role-row.sel {
    background: color-mix(in oklab, var(--gold) 14%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--gold) 38%, transparent);
  }

  .col {
    display: grid;
    gap: 0.1rem;
    min-width: 0;
    flex: 1;
  }

  .tier {
    font-size: 0.55rem;
    letter-spacing: 0.14em;
    color: var(--gold);
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    opacity: 0.8;
  }

  .scrim {
    position: fixed;
    inset: 0;
    z-index: 55;
    border: 0;
    background: transparent;
  }

  @media (min-width: 1181px) {
    .show-sm { display: none; }
  }

  @media (max-width: 1180px) {
    .hide-sm { display: none; }
  }

  @media (max-width: 900px) {
    .readouts { gap: 0.6rem; padding-left: 0.6rem; }
    .stage-chip { display: none; }
    .brand-text em { display: none; }
  }

  @media (max-width: 620px) {
    .readouts { display: none; }
    .pop, .pop.wide { width: min(340px, calc(100vw - 2rem)); right: -3rem; }
  }
</style>
