/**
 * HELIO-FORGE — Android release artifact resolution
 * ============================================================================
 * The one-tap download must never hand the user a dead link, a 1210-byte
 * placeholder, or a made-up checksum. This module is the single source of truth
 * for "what APK can we actually serve right now", and it is deliberately honest
 * about the three states:
 *
 *   ready        a real APK (>1 MB, PK zip magic) is on the CDN
 *   placeholder  only scripts/make-apk-stub.mjs output is there — the CI build
 *                has not run yet
 *   absent       nothing at all (404)
 *
 * Resolution order, first hit wins:
 *   1. the in-app static bundle  /releases/helioforge-release.apk
 *   2. the GitHub Release asset  .../releases/latest/download/HelioForge-SolarAR-v1.0.0.apk
 *      (this is what makes the button work before CI has ever committed an APK)
 *   3. the Vercel build output api/releases.json, if present
 *
 * Sizes are taken from Content-Length on a HEAD request. SHA-256 is never
 * invented: it comes from the build output or the GitHub Release body, and is
 * null when unknown so the UI can say so.
 */

// @ts-nocheck — validated by scripts/cloud-contract.mjs / apk-release checks

export const APK_LOCAL_PATH = '/releases/helioforge-release.apk';

/** Must match `.github/workflows/build-and-bundle-apk.yml` and the release tag. */
export const APK_FILE_NAME = 'HelioForge-SolarAR-v1.0.0.apk';

export const APK_REPO = 'kennedy-blip/helio-forge';
export const APK_RELEASE_TAG = 'HelioForge-SolarAR-v1.0.0';

export const APK_GITHUB_URL = `https://github.com/${APK_REPO}/releases/latest/download/${APK_FILE_NAME}`;
export const APK_RELEASE_PAGE = `https://github.com/${APK_REPO}/releases/latest`;

/**
 * The gallery is served over the network but the APK runs from
 * `https://helioforge.local`, where a root-relative fetch hits the WebView
 * asset server and 404s. Set VITE_APP_ORIGIN (e.g. https://helio-forge.vercel.app)
 * or the runtime override below so the packaged app can still find the CDN.
 */
const APP_ORIGIN_KEY = 'helioforge.app.origin.v1';

function appOrigin() {
  if (typeof localStorage !== 'undefined') {
    try {
      const override = localStorage.getItem(APP_ORIGIN_KEY);
      if (override) return override.replace(/\/+$/, '');
    } catch {
      /* ignore */
    }
  }
  try {
    const envOrigin = import.meta.env?.VITE_APP_ORIGIN ?? '';
    if (envOrigin) return envOrigin.replace(/\/+$/, '');
  } catch {
    /* not in Vite */
  }
  return '';
}

/** Below this, the file is the ZIP placeholder from scripts/make-apk-stub.mjs. */
export const MIN_REAL_APK_BYTES = 1_000_000;

const MANIFEST_PATH = '/api/releases.json';
const CACHE_KEY = 'helioforge.apk.release.v1';

/**
 * @typedef {object} ReleaseInfo
 * @property {'ready'|'placeholder'|'absent'|'checking'} state
 * @property {string|null} url        absolute or root-relative download target
 * @property {string} source          'bundle' | 'github' | 'manifest' | 'none'
 * @property {number} bytes
 * @property {string|null} sha256
 * @property {string|null} version
 * @property {string|null} error
 */

/** @type {ReleaseInfo} */
export const UNKNOWN_RELEASE = {
  state: 'checking',
  url: null,
  source: 'none',
  bytes: 0,
  sha256: null,
  version: null,
  error: null
};

function absolute(path) {
  const base = appOrigin() || (typeof window !== 'undefined' ? window.location.origin : '');
  if (!base) return path;
  try {
    return new URL(path, base).toString();
  } catch {
    return path;
  }
}

/** HEAD the artifact without downloading it. Never throws. */
async function probe(url, timeoutMs = 8000) {
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      // Vercel and GitHub both answer HEAD; no credentials are needed.
      cache: 'no-store',
      signal: ac?.signal
    });
    if (!res.ok) return { ok: false, status: res.status, bytes: 0 };
    const bytes = Number(res.headers.get('content-length') ?? 0);
    return { ok: true, status: res.status, bytes, type: res.headers.get('content-type') ?? '' };
  } catch (err) {
    return { ok: false, status: 0, bytes: 0, error: err?.name === 'AbortError' ? 'timeout' : err?.message };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function readCache() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
    if (!raw?.at) return null;
    // Re-probe at most every 10 minutes; the APK changes on CI runs, not on reloads.
    if (Date.now() - raw.at > 10 * 60 * 1000) return null;
    return raw.info;
  } catch {
    return null;
  }
}

function writeCache(info) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), info }));
  } catch {
    /* ignore */
  }
}

/**
 * Resolve the best servable APK.
 * @param {{force?: boolean}} [opts]
 * @returns {Promise<ReleaseInfo>}
 */
export async function resolveRelease({ force = false } = {}) {
  if (!force) {
    const cached = readCache();
    if (cached) return cached;
  }

  // 1 — the APK committed into the static bundle by CI.
  const local = await probe(APK_LOCAL_PATH);
  if (local.ok && local.bytes >= MIN_REAL_APK_BYTES) {
    const info = {
      state: 'ready',
      url: absolute(APK_LOCAL_PATH),
      source: 'bundle',
      bytes: local.bytes,
      sha256: null,
      version: APK_RELEASE_TAG,
      error: null
    };
    writeCache(info);
    return info;
  }

  // 2 — a GitHub Release asset, which exists as soon as CI has published once
  //     even if the committed bundle copy is stale.
  const gh = await probe(APK_GITHUB_URL);
  if (gh.ok && gh.bytes >= MIN_REAL_APK_BYTES) {
    const info = {
      state: 'ready',
      url: APK_GITHUB_URL,
      source: 'github',
      bytes: gh.bytes,
      sha256: null,
      version: APK_RELEASE_TAG,
      error: null
    };
    writeCache(info);
    return info;
  }

  // 3 — an optional build manifest emitted next to the app.
  try {
    const res = await fetch(MANIFEST_PATH, { cache: 'no-store' });
    if (res.ok) {
      const m = await res.json();
      if (m?.url) {
        const target = /^https?:/.test(m.url) ? m.url : absolute(m.url);
        const mp = await probe(target);
        if (mp.ok && mp.bytes >= MIN_REAL_APK_BYTES) {
          const info = {
            state: 'ready',
            url: target,
            source: 'manifest',
            bytes: mp.bytes,
            sha256: m.sha256 ?? null,
            version: m.version ?? null,
            error: null
          };
          writeCache(info);
          return info;
        }
      }
    }
  } catch {
    /* no manifest — expected today */
  }

  // Nothing real. Report the placeholder truthfully so the UI can explain it.
  const info = local.ok
    ? {
        state: 'placeholder',
        url: absolute(APK_LOCAL_PATH),
        source: 'bundle',
        bytes: local.bytes,
        sha256: null,
        version: null,
        error: null
      }
    : {
        state: 'absent',
        url: null,
        source: 'none',
        bytes: 0,
        sha256: null,
        version: null,
        error: 'no release artifact published'
      };
  writeCache(info);
  return info;
}

/**
 * Trigger the download. Returns the ReleaseInfo that was actually used, so the
 * caller can report the real source instead of optimistically claiming success.
 */
export async function downloadRelease() {
  const info = await resolveRelease({ force: true });
  if (info.state !== 'ready' || !info.url) return info;

  const a = document.createElement('a');
  a.href = info.url;
  // `download` is honoured same-origin; for the GitHub fallback the link opens
  // GitHub's asset redirect, which already sends Content-Disposition.
  a.download = APK_FILE_NAME;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  return info;
}

/** Human-readable byte count for the specs grid. */
export function formatBytes(bytes) {
  if (!bytes) return '—';
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
