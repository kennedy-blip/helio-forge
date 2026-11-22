<script>
  import { app, ROLES, PERMISSIONS, closeModal, setRole, currentRole, toast } from '$lib/state/app.svelte.js';

  const role = $derived(currentRole());

  async function togglePerm(p) {
    const current = app.permissions[p.id];
    if (!current) {
      // Attempt a real acquisition for the permissions we can actually request
      try {
        if (p.id === 'camera' && navigator.mediaDevices?.getUserMedia) {
          const s = await navigator.mediaDevices.getUserMedia({ video: true });
          s.getTracks().forEach((t) => t.stop());
          app.permissions.camera = true;
          app.permissionStatus.camera = 'WEB ACTIVE';
          toast('Camera granted', 'success');
          return;
        }
        if (p.id === 'orientation' && window.DeviceOrientationEvent) {
          /** @type {any} */
          const DOE = window.DeviceOrientationEvent;
          if (DOE.requestPermission) {
            const res = await DOE.requestPermission();
            if (res !== 'granted') throw new Error('denied');
          }
          app.permissions.orientation = true;
          app.permissionStatus.orientation = 'WEB ACTIVE';
          app.sensorSource = 'WEB ACTIVE';
          toast('Clinometer + compass granted', 'success');
          return;
        }
        if (p.id === 'geolocation' && navigator.geolocation) {
          await new Promise((res, rej) =>
            navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 })
          );
          app.permissions.geolocation = true;
          app.permissionStatus.geolocation = 'WEB ACTIVE';
          toast('GPS locked', 'success');
          return;
        }
        if (p.id === 'haptics') {
          app.permissions.haptics = true;
          app.permissionStatus.haptics = typeof navigator.vibrate === 'function' ? 'WEB ACTIVE' : 'RESTRICTED';
          if (navigator.vibrate) navigator.vibrate([14, 40, 14]);
          toast('Haptics enabled', 'success');
          return;
        }
        if (p.id === 'battery') {
          app.permissions.battery = true;
          app.permissionStatus.battery = 'WEB ACTIVE';
          toast('Battery telemetry subscribed', 'success');
          return;
        }
      } catch (err) {
        app.permissionStatus[p.id] = 'RESTRICTED';
        toast(`${p.name}: ${err?.message ?? 'denied'}`, 'warn');
        return;
      }
    }
    app.permissions[p.id] = false;
    app.permissionStatus[p.id] = p.id === 'geolocation' ? 'PRESET LOCK' : 'SIMULATOR ACTIVE';
  }

  const FEATURE_MATRIX = [
    ['AR Solar-Path Heliodon', 'ar-heliodon'],
    ['Live Tilt Clinometer', 'clinometer'],
    ['Power Station Runtime', 'autonomy'],
    ['Site Vault (IndexedDB)', 'vault'],
    ['Thermal Cell Derating γ', 'thermal'],
    ['Horizon Shade Editor', 'horizon-editor'],
    ['Installer Quote Audit', 'quote'],
    ['MPPT String Sizer', 'strings'],
    ['Polyglot Runtime Inspector', 'polyglot'],
    ['GLSL Uniform Debugger', 'glsl-debug'],
    ['CSV / JSON Irradiance Export', 'export'],
    ['IndexedDB Sync Queue', 'sync-queue']
  ];
</script>

<div class="priv glass">
  <header class="row between">
    <div>
      <p class="eyebrow" style="color: var(--violet)">Privileges & Polyglot Runtime</p>
      <h2 class="display" style="font-size:1.55rem; margin-top:.2rem;">
        Access, Roles & <span class="gradient-text">Hardware Permissions</span>
      </h2>
    </div>
    <button class="btn icon ghost" onclick={closeModal} aria-label="Close">✕</button>
  </header>

  <!-- ============================================================== roles -->
  <section>
    <p class="eyebrow">Role-based access control</p>
    <div class="role-grid">
      {#each ROLES as r}
        <button class="role-card" class:sel={app.role === r.id} onclick={() => setRole(r.id)}>
          <span class="tier-chip">{r.tier}</span>
          <strong class="small">{r.name}</strong>
          <span class="tiny-text faint">{r.blurb}</span>
          <span class="unlock-count mono tiny-text">{r.unlocks.length} capabilities</span>
        </button>
      {/each}
    </div>
  </section>

  <div class="two-col">
    <!-- ======================================================= permissions -->
    <section>
      <p class="eyebrow">Hardware & OS sensor permission matrix</p>
      <div class="perm-list">
        {#each PERMISSIONS as p}
          <div class="perm" class:on={app.permissions[p.id]}>
            <div class="perm-head">
              <span class="small bold">{p.name}</span>
              <button class="toggle" class:on={app.permissions[p.id]} onclick={() => togglePerm(p)} aria-pressed={app.permissions[p.id]} aria-label={`Toggle ${p.name}`}></button>
            </div>
            <p class="tiny-text faint">{p.detail}</p>
            <div class="perm-meta">
              <code class="mono tiny-text">{p.api}</code>
              <span class="chip tiny" class:ok={app.permissionStatus[p.id]?.includes('ACTIVE')} class:warn={app.permissionStatus[p.id] === 'SIMULATOR ACTIVE'}>
                {app.permissionStatus[p.id]}
              </span>
            </div>
            <p class="tiny-text faint">{p.web} {#if p.native}· {p.native}{/if}</p>
          </div>
        {/each}
      </div>
    </section>

    <!-- ============================================================ matrix -->
    <section>
      <p class="eyebrow">Capability matrix · {role.tier}</p>
      <div class="matrix">
        {#each FEATURE_MATRIX as [label, feature]}
          <div class="mrow" class:yes={role.unlocks.includes(feature)}>
            <span class="small">{label}</span>
            <span class="mono tiny-text">{role.unlocks.includes(feature) ? 'UNLOCKED' : 'LOCKED'}</span>
          </div>
        {/each}
      </div>

      <div class="runtime-card">
        <p class="eyebrow">Polyglot runtime status</p>
        <div class="rt-row"><span class="lang py">PY</span><span class="tiny-text">Python 3.12 Vercel function</span><span class="chip tiny ok">ready</span></div>
        <div class="rt-row"><span class="lang wasm">WA</span><span class="tiny-text">Pyodide offline bridge</span><span class="chip tiny ok">fallback</span></div>
        <div class="rt-row"><span class="lang js">JS</span><span class="tiny-text">Deterministic JS mirror</span><span class="chip tiny ok">always</span></div>
        <div class="rt-row"><span class="lang glsl">GL</span><span class="tiny-text">WebGL2 shaders</span><span class="chip tiny" class:ok={!app.lowGpu}>{app.lowGpu ? 'eco' : 'full'}</span></div>
        <div class="rt-row"><span class="lang kt">KT</span><span class="tiny-text">Kotlin sensor bridge</span><span class="chip tiny warn">{app.sensorSource}</span></div>
      </div>
    </section>
  </div>
</div>

<style>
  .priv {
    padding: 1.3rem 1.45rem 1.2rem;
    display: grid;
    gap: 1rem;
  }

  .role-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 0.5rem;
    margin-top: 0.4rem;
  }

  .role-card {
    display: grid;
    gap: 0.16rem;
    padding: 0.7rem 0.75rem;
    border-radius: 14px;
    border: 1px solid var(--border);
    background: color-mix(in oklab, var(--surface-solid) 46%, transparent);
    text-align: left;
    transition: all 220ms ease;
  }

  .role-card:hover { border-color: var(--border-hi); transform: translateY(-1px); }

  .role-card.sel {
    border-color: color-mix(in oklab, var(--gold) 52%, transparent);
    background: color-mix(in oklab, var(--gold) 12%, transparent);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--gold) 30%, transparent);
  }

  .tier-chip {
    justify-self: start;
    font-size: 0.54rem;
    font-weight: 760;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 0.12rem 0.4rem;
    border-radius: 999px;
    background: color-mix(in oklab, var(--cyan) 18%, transparent);
    color: color-mix(in oklab, var(--cyan) 86%, white);
  }

  .unlock-count { color: var(--emerald); }

  .two-col {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
    gap: 1rem;
  }

  .perm-list { display: grid; gap: 0.35rem; margin-top: 0.4rem; }

  .perm {
    padding: 0.55rem 0.65rem;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: color-mix(in oklab, var(--surface-solid) 38%, transparent);
    display: grid;
    gap: 0.22rem;
    transition: all 200ms ease;
  }

  .perm.on {
    border-color: color-mix(in oklab, var(--emerald) 38%, transparent);
    background: color-mix(in oklab, var(--emerald) 8%, transparent);
  }

  .perm-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .perm-meta {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .perm-meta code {
    padding: 0.08rem 0.34rem;
    border-radius: 5px;
    background: color-mix(in oklab, var(--surface-solid) 76%, transparent);
  }

  .matrix { display: grid; gap: 0.16rem; margin-top: 0.4rem; }

  .mrow {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.3rem 0.5rem;
    border-radius: 8px;
    background: color-mix(in oklab, var(--surface-solid) 34%, transparent);
    opacity: 0.62;
  }

  .mrow.yes {
    opacity: 1;
    background: color-mix(in oklab, var(--emerald) 9%, transparent);
  }

  .mrow.yes .mono { color: var(--emerald); }

  .runtime-card {
    margin-top: 0.7rem;
    padding: 0.6rem 0.7rem;
    border-radius: 13px;
    border: 1px solid var(--border);
    background: color-mix(in oklab, var(--surface-solid) 42%, transparent);
    display: grid;
    gap: 0.26rem;
  }

  .rt-row {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }

  .rt-row .tiny-text { flex: 1; }

  .lang {
    width: 26px;
    height: 20px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    font-size: 0.5rem;
    font-weight: 800;
    flex: none;
  }

  .lang.py { background: rgba(245, 158, 11, 0.2); color: #FCD34D; }
  .lang.wasm { background: rgba(139, 92, 246, 0.2); color: #C4B5FD; }
  .lang.js { background: rgba(250, 204, 21, 0.18); color: #FDE68A; }
  .lang.glsl { background: rgba(34, 211, 238, 0.18); color: #67E8F9; }
  .lang.kt { background: rgba(16, 185, 129, 0.18); color: #6EE7B7; }

  @media (max-width: 860px) {
    .two-col { grid-template-columns: 1fr; }
  }
</style>
