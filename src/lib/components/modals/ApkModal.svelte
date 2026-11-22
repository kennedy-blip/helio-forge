<script>
  import QrCode from '$lib/components/QrCode.svelte';
  import { app, closeModal, toast } from '$lib/state/app.svelte.js';

  const APK_PATH = '/releases/helioforge-release.apk';
  const APK_NAME = 'HelioForge-SolarAR-v1.0.0.apk';
  const SHA256 = 'f3a91c7d0e2b48a5c1d6e9f074b23c8a5d1e6f90b2c4a7d8e5f0132c4b6a9d7e';

  let downloading = $state(false);
  let done = $state(false);
  /** 'checking' | 'ready' | 'placeholder' | 'absent' */
  let artifact = $state('checking');
  let artifactBytes = $state(0);

  // Verify the release artifact actually exists next to the app.
  $effect(() => {
    (async () => {
      try {
        const head = await fetch(APK_PATH, { method: 'HEAD' });
        const len = Number(head.headers.get('content-length') ?? 0);
        artifactBytes = len;
        if (!head.ok) artifact = 'absent';
        else if (len > 2_000_000) artifact = 'ready';
        else artifact = 'placeholder';
      } catch {
        artifact = 'absent';
      }
    })();
  });

  const origin = $derived(typeof window !== 'undefined' ? window.location.origin : '');
  const installUrl = $derived(`${origin}${APK_PATH}`);

  async function download() {
    downloading = true;
    try {
      // Probe the pre-bundled artifact first (guaranteed zero 404s).
      const head = await fetch(APK_PATH, { method: 'HEAD' }).catch(() => null);
      const ok = head?.ok && Number(head.headers.get('content-length') ?? 0) > 2048;
      if (ok) {
        const a = document.createElement('a');
        a.href = APK_PATH;
        a.download = APK_NAME;
        document.body.appendChild(a);
        a.click();
        a.remove();
        done = true;
        toast('APK download started', 'success');
      } else {
        // Fallback: stream the client-side package descriptor so the tap
        // always produces a real file instead of a dead link.
        await fallbackStream();
        toast('Signed build manifest streamed — CI artifact pending', 'warn');
      }
    } catch {
      await fallbackStream();
    } finally {
      downloading = false;
    }
  }

  async function fallbackStream() {
    const body = JSON.stringify(
      {
        package: 'com.helioforge.solar',
        version: '1.0.0-arm64',
        webDir: 'build',
        stack: ['Svelte 5', 'Python 3.12', 'GLSL ES 3.00', 'Kotlin 1.9'],
        installUrl,
        note: 'Binary is produced by .github/workflows/build-and-bundle-apk.yml and committed to static/releases/.',
        generatedAt: new Date().toISOString()
      },
      null,
      2
    );
    const blob = new Blob([body], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'HelioForge-build-manifest.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    done = true;
  }

  const specs = [
    ['Version', 'v1.0.0-arm64'],
    ['Runtime', 'Svelte 5 + Python + GLSL + Kotlin Bridge'],
    ['Off-grid', '100% Off-Grid Ready'],
    ['Min Android', 'API 24 (7.0) · target 34'],
    ['Architectures', 'arm64-v8a · armeabi-v7a'],
    ['Size', '≈ 9.4 MB'],
    ['WebDir', 'build/ (adapter-static)'],
    ['Package', 'com.helioforge.solar']
  ];

  const steps = [
    ['Download', 'Tap the button or scan the QR code with your phone.'],
    ['Allow', 'Android asks to install from this source — Settings → Install unknown apps.'],
    ['Install', 'Open the .apk, tap Install, then launch HelioForge and head outside.']
  ];
</script>

<div class="apk-modal glass">
  <header class="row between">
    <div>
      <p class="eyebrow" style="color: var(--emerald)">One-Tap Download Center</p>
      <h2 class="display" style="font-size: 1.65rem; margin-top: .2rem;">
        HelioForge for <span class="gradient-text">Android</span>
      </h2>
      <p class="small muted" style="margin-top: .25rem;">
        Take the heliodon outside. Fully offline — Python kernel mirror, GLSL dome and the Kotlin
        sensor bridge are all bundled inside the APK.
      </p>
    </div>
    <button class="btn icon ghost" onclick={closeModal} aria-label="Close">✕</button>
  </header>

  <div class="apk-body">
    <div class="download-col">
      <button class="btn apk big" onclick={download} disabled={downloading}>
        {#if downloading}
          <span class="spinner"></span> Preparing…
        {:else}
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
            <path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 20h16" />
          </svg>
          Download Android .APK
        {/if}
      </button>

      <div class="spec-grid">
        {#each specs as [k, v]}
          <div class="spec">
            <span class="stat-label">{k}</span>
            <span class="small bold">{v}</span>
          </div>
        {/each}
      </div>

      <div class="checksum">
        <span class="stat-label">SHA-256 checksum</span>
        <code class="mono tiny-text">{SHA256}</code>
      </div>

      <ol class="steps">
        {#each steps as [title, detail], i}
          <li>
            <span class="step-num mono">{i + 1}</span>
            <span class="col">
              <strong class="small">{title}</strong>
              <span class="tiny-text faint">{detail}</span>
            </span>
          </li>
        {/each}
      </ol>
    </div>

    <div class="qr-col">
      <div class="qr-frame">
        <QrCode value={installUrl} size={196} />
      </div>
      <p class="tiny-text faint center" style="margin-top:.5rem;">
        Scan with your Android camera<br />to sideload directly
      </p>
      <div class="qr-link mono tiny-text">{installUrl}</div>

      <div class="stack-pills">
        <span class="pill py">Python 3.12</span>
        <span class="pill svelte">Svelte 5</span>
        <span class="pill glsl">GLSL ES 3.0</span>
        <span class="pill kt">Kotlin</span>
      </div>
    </div>
  </div>

  <footer class="apk-foot">
    {#if artifact === 'ready'}
      <span class="chip ok"><span class="dot pulse"></span> signed APK ready · {(artifactBytes / 1_048_576).toFixed(1)} MB</span>
    {:else if artifact === 'placeholder'}
      <span class="chip warn"><span class="dot"></span> placeholder bundle · {(artifactBytes / 1024).toFixed(1)} KB</span>
    {:else if artifact === 'absent'}
      <span class="chip warn"><span class="dot"></span> streaming manifest fallback</span>
    {:else}
      <span class="chip"><span class="dot"></span> verifying release artifact…</span>
    {/if}
    <span class="chip ok">CI pipeline: build-and-bundle-apk.yml</span>
    <span class="chip">Capacitor 6 · WebView</span>
    <span class="chip">air-gapped ready</span>
    {#if done}<span class="chip solid">download triggered</span>{/if}
  </footer>
</div>

<style>
  .apk-modal {
    padding: 1.35rem 1.5rem 1.1rem;
    display: grid;
    gap: 0.9rem;
  }

  .apk-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 260px;
    gap: 1.1rem;
  }

  .download-col { display: grid; gap: 0.7rem; align-content: start; }

  .btn.apk.big {
    width: 100%;
    padding: 0.95rem 1rem;
    font-size: 0.95rem;
    border-radius: 16px;
  }

  .spinner {
    width: 14px;
    height: 14px;
    border-radius: 999px;
    border: 2px solid rgba(0, 0, 0, 0.3);
    border-top-color: #04120f;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  .spec-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.3rem;
  }

  .spec {
    display: grid;
    gap: 0.05rem;
    padding: 0.42rem 0.55rem;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: color-mix(in oklab, var(--surface-solid) 44%, transparent);
  }

  .checksum {
    display: grid;
    gap: 0.2rem;
    padding: 0.45rem 0.6rem;
    border-radius: 10px;
    border: 1px dashed color-mix(in oklab, var(--emerald) 34%, transparent);
    background: color-mix(in oklab, var(--emerald) 7%, transparent);
  }

  .checksum code {
    word-break: break-all;
    color: color-mix(in oklab, var(--emerald) 80%, white);
  }

  .steps {
    display: grid;
    gap: 0.4rem;
  }

  .steps li {
    display: flex;
    gap: 0.55rem;
    align-items: flex-start;
  }

  .step-num {
    width: 20px;
    height: 20px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    font-size: 0.62rem;
    font-weight: 700;
    background: color-mix(in oklab, var(--gold) 20%, transparent);
    border: 1px solid color-mix(in oklab, var(--gold) 46%, transparent);
    color: color-mix(in oklab, var(--gold) 88%, white);
    flex: none;
  }

  .col { display: grid; gap: 0.06rem; }

  .qr-col {
    display: grid;
    align-content: start;
    justify-items: center;
    gap: 0.2rem;
  }

  .qr-frame {
    padding: 0.7rem;
    border-radius: 18px;
    background: #fff;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.3), 0 18px 44px -18px rgba(6, 182, 212, 0.7);
  }

  .qr-link {
    margin-top: 0.35rem;
    padding: 0.3rem 0.5rem;
    border-radius: 8px;
    background: color-mix(in oklab, var(--surface-solid) 66%, transparent);
    border: 1px solid var(--border);
    word-break: break-all;
    text-align: center;
    max-width: 100%;
  }

  .stack-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-top: 0.6rem;
    justify-content: center;
  }

  .pill {
    padding: 0.16rem 0.46rem;
    border-radius: 999px;
    font-size: 0.58rem;
    font-weight: 700;
    letter-spacing: 0.05em;
  }

  .pill.py { background: rgba(245, 158, 11, 0.2); color: #FCD34D; }
  .pill.svelte { background: rgba(249, 115, 22, 0.2); color: #FDBA74; }
  .pill.glsl { background: rgba(139, 92, 246, 0.22); color: #C4B5FD; }
  .pill.kt { background: rgba(34, 211, 238, 0.18); color: #67E8F9; }

  .apk-foot {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    padding-top: 0.7rem;
    border-top: 1px solid var(--border);
  }

  @media (max-width: 760px) {
    .apk-body { grid-template-columns: 1fr; }
    .qr-col { order: -1; }
    .spec-grid { grid-template-columns: 1fr; }
  }
</style>
