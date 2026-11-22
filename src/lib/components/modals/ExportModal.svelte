<script>
  import { closeModal, app, toast, can, openModal } from '$lib/state/app.svelte.js';
  import { annualIrradianceCurve } from '$lib/solar/kernel.js';

  const privileged = $derived(can('export'));
  const curve = $derived(
    annualIrradianceCurve(app.latitude, app.longitude, app.panel.tilt, app.panel.azimuth, app.horizon ?? null)
  );

  /** @param {string} name @param {any} content @param {string} type */
  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(`${name} exported`, 'success');
  }

  function exportCsv() {
    const head = 'doy,month,day,poa_kwh_m2';
    const body = curve.map((p) => `${p.doy},${p.month},${p.day},${p.kwhM2}`).join('\n');
    download(`helio-irradiance-${app.site.id ?? 'site'}.csv`, `${head}\n${body}`, 'text/csv');
  }

  function exportJson() {
    const payload = {
      site: app.site,
      generatedAt: new Date().toISOString(),
      latitude: app.latitude,
      longitude: app.longitude,
      tilt: app.panel.tilt,
      azimuth: app.panel.azimuth,
      horizon: app.horizon,
      curve
    };
    download(`helio-irradiance-${app.site.id ?? 'site'}.json`, JSON.stringify(payload, null, 2), 'application/json');
  }

  const bytes = $derived(
    new Blob([curve.map((p) => `${p.doy},${p.month},${p.day},${p.kwhM2}`).join('\n')]).size
  );
</script>

<div class="export glass">
  <header class="row between">
    <div>
      <p class="eyebrow" style="color: var(--cyan)">Raw Irradiance Exporter</p>
      <h2 class="display" style="font-size:1.4rem; margin-top:.2rem;">365-day POA dataset</h2>
      <p class="tiny-text faint">{app.site.name} · tilt {app.panel.tilt}° · azimuth {app.panel.azimuth}° · {app.horizon.length} horizon nodes</p>
    </div>
    <button class="btn icon ghost" onclick={closeModal} aria-label="Close">✕</button>
  </header>

  {#if privileged}
    <div class="grid cols-2">
      <button class="btn primary" onclick={exportCsv}>⤓ Export CSV ({(bytes / 1024).toFixed(1)} KB)</button>
      <button class="btn ghost" onclick={exportJson}>⤓ Export JSON</button>
    </div>
    <pre class="preview mono">{curve.slice(0, 6).map((p) => `${p.doy},${p.month},${p.day},${p.kwhM2}`).join('\n')}
…
{curve.slice(-2).map((p) => `${p.doy},${p.month},${p.day},${p.kwhM2}`).join('\n')}</pre>
  {:else}
    <p class="small muted">The raw JSON/CSV irradiance exporter is an Admin-tier capability.</p>
    <button class="btn primary tiny" onclick={() => openModal('privileges')}>Switch to Architect tier</button>
  {/if}
</div>

<style>
  .export {
    padding: 1.2rem 1.35rem 1.1rem;
    display: grid;
    gap: 0.7rem;
  }

  .preview {
    margin: 0;
    padding: 0.6rem 0.7rem;
    border-radius: 10px;
    background: #04070d;
    border: 1px solid var(--border);
    font-size: 0.68rem;
    line-height: 1.55;
    color: #bfe0f5;
    overflow-x: auto;
  }
</style>
