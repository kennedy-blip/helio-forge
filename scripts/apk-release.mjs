/**
 * HELIO-FORGE — APK release pipeline contract
 * ============================================================================
 *   node scripts/apk-release.mjs
 *
 * The APK can only be built on a runner with an Android SDK, so nothing here
 * compiles one. Instead this locks down everything that silently breaks the
 * one-tap download *between* builds:
 *
 *   • every @mipmap/@drawable/@string/@style the AndroidManifest references
 *     actually exists (a missing launcher icon fails :processReleaseResources
 *     long before any Kotlin is compiled);
 *   • the workflow publishes the exact filename the client looks for, under the
 *     exact tag whose "latest release" URL is hard-coded in release.js;
 *   • the client still refuses to call a placeholder "ready".
 *
 * Exit code is non-zero on failure so CI can gate the Gradle step on it.
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync, crc32 } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];

async function check(name, fn) {
  try {
    results.push({ ok: true, name, detail: await fn() });
  } catch (err) {
    results.push({ ok: false, name, detail: err.message });
  }
}
function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const exists = (rel) => existsSync(resolve(root, rel));

const manifest = read('android/app/src/main/AndroidManifest.xml');
const workflow = read('.github/workflows/build-and-bundle-apk.yml');
const releaseJs = read('src/lib/apk/release.js');
const modal = read('src/lib/components/modals/ApkModal.svelte');

/* --------------------------------------------------- android resource refs */

await check('manifest launcher icons resolve to real files', () => {
  const buckets = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
  const missing = [];
  for (const bucket of buckets) {
    for (const icon of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
      const rel = `android/app/src/main/res/mipmap-${bucket}/${icon}`;
      if (!exists(rel)) missing.push(rel);
    }
  }
  assert(missing.length === 0, `missing: ${missing.join(', ')}`);
  return `${buckets.length * 3} icon files`;
});

await check('every launcher PNG is structurally valid (AAPT2 will reject otherwise)', () => {
  // AAPT2 reports the unhelpful "AAPT2 process unexpectedly exit" for a PNG
  // whose IDAT payload is one byte short, so decode the format properly:
  // chunk CRCs, IHDR dimensions, and raw payload length for the stated depth.
  const dir = resolve(root, 'android/app/src/main/res');
  const files = [];
  for (const bucket of readdirSync(dir)) {
    if (!bucket.startsWith('mipmap-')) continue;
    for (const f of readdirSync(resolve(dir, bucket))) {
      if (f.endsWith('.png')) files.push(resolve(dir, bucket, f));
    }
  }
  assert(files.length === 15, `expected 15 launcher PNGs, found ${files.length}`);

  const bad = [];
  for (const file of files) {
    const buf = readFileSync(file);
    const short = file.slice(file.indexOf('mipmap'));
    if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
      bad.push(`${short}: bad signature`);
      continue;
    }
    let pos = 8;
    let ihdr = null;
    const idat = [];
    let crcFail = false;
    while (pos < buf.length) {
      const len = buf.readUInt32BE(pos);
      const tag = buf.subarray(pos + 4, pos + 8);
      const data = buf.subarray(pos + 8, pos + 8 + len);
      const want = buf.readUInt32BE(pos + 8 + len);
      if (crc32(Buffer.concat([tag, data])) !== want) crcFail = true;
      if (tag.toString() === 'IHDR') {
        ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
      } else if (tag.toString() === 'IDAT') {
        idat.push(data);
      }
      pos += 12 + len;
    }
    if (crcFail) { bad.push(`${short}: chunk CRC mismatch`); continue; }
    if (!ihdr || ihdr.interlace !== 0) { bad.push(`${short}: missing or interlaced IHDR`); continue; }
    const bpp = { 2: 3, 6: 4 }[ihdr.color];
    if (!bpp || ihdr.depth !== 8) { bad.push(`${short}: unexpected depth/color ${ihdr.depth}/${ihdr.color}`); continue; }
    let raw;
    try {
      raw = inflateSync(Buffer.concat(idat));
    } catch {
      bad.push(`${short}: IDAT does not inflate`);
      continue;
    }
    const expected = (ihdr.w * bpp + 1) * ihdr.h;
    if (raw.length !== expected) {
      bad.push(`${short}: ${raw.length} bytes, expected ${expected} (one filter byte per row)`);
      continue;
    }
    for (let y = 0; y < ihdr.h; y += 1) {
      if (raw[y * (ihdr.w * bpp + 1)] !== 0) { bad.push(`${short}: unsupported filter type`); break; }
    }
  }
  assert(bad.length === 0, bad.slice(0, 4).join('; '));
  return `${files.length} PNGs decoded`;
});

check('adaptive icon and its background colour exist', () => {
  for (const rel of [
    'android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml',
    'android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml',
    'android/app/src/main/res/values/ic_launcher_background.xml'
  ]) {
    assert(exists(rel), `missing ${rel}`);
  }
  return 'API 26+ adaptive icon';
});

await check('every @mipmap/@drawable/@string/@style/@xml in the manifest resolves', () => {
  const refs = [...manifest.matchAll(/@(mipmap|drawable|string|style|xml|color)\/(\w+)/g)];
  assert(refs.length > 0, 'no resource references found — manifest not parsed');

  const values = read('android/app/src/main/res/values/strings.xml') +
    read('android/app/src/main/res/values/styles.xml') +
    read('android/app/src/main/res/values/ic_launcher_background.xml');

  const unresolved = [];
  for (const [, kind, name] of refs) {
    if (kind === 'mipmap') {
      const ok = exists(`android/app/src/main/res/mipmap-anydpi-v26/${name}.xml`) ||
        exists(`android/app/src/main/res/mipmap-xxxhdpi/${name}.png`);
      if (!ok) unresolved.push(`@mipmap/${name}`);
    } else if (kind === 'drawable') {
      if (!exists(`android/app/src/main/res/drawable/${name}.xml`)) unresolved.push(`@drawable/${name}`);
    } else if (kind === 'xml') {
      if (!exists(`android/app/src/main/res/xml/${name}.xml`)) unresolved.push(`@xml/${name}`);
    } else if (kind === 'string') {
      if (!new RegExp(`name="${name}"`).test(values)) unresolved.push(`@string/${name}`);
    } else if (kind === 'style') {
      if (!new RegExp(`name="${name}"`).test(values)) unresolved.push(`@style/${name}`);
    } else if (kind === 'color') {
      if (!new RegExp(`name="${name.replace(/^ic_launcher_background$/, 'ic_launcher_background')}"`).test(values)) {
        unresolved.push(`@color/${name}`);
      }
    }
  }
  assert(unresolved.length === 0, `unresolved: ${[...new Set(unresolved)].join(', ')}`);
  return `${refs.length} references`;
});

await check('proguardFiles target exists', () => {
  assert(exists('android/app/proguard-rules.pro'), 'android/app/proguard-rules.pro missing');
});

/* ------------------------------------------------------------- workflow */

await check('workflow provisions a Gradle toolchain (no committed wrapper needed)', () => {
  assert(/gradle\/actions\/setup-gradle/.test(workflow), 'setup-gradle action missing');
  assert(/gradle-version:\s*'8\.7'/.test(workflow), 'Gradle 8.7 not pinned');
  return 'Gradle 8.7 via setup-gradle';
});

await check('workflow refuses to publish an implausible artifact', () => {
  assert(/grep -q 'PK'/.test(workflow), 'no PK/zip magic check');
  assert(/-lt 1000000/.test(workflow), 'no minimum size guard');
  return 'zip magic + 1 MB floor';
});

await check('workflow asset name matches the client download target', () => {
  const wfName = /APK_STEM:\s*(\S+)/.exec(workflow)?.[1];
  assert(wfName === 'helioforge-release', `APK_STEM is ${wfName}`);
  const clientPath = /APK_LOCAL_PATH = '([^']+)'/.exec(releaseJs)?.[1];
  assert(clientPath === '/releases/helioforge-release.apk', `client path is ${clientPath}`);
  const wfFile = /files:\s*static\/releases\/(\S+)/.exec(workflow)?.[1];
  assert(wfFile === 'helioforge-release.apk', `release attaches ${wfFile}`);
  return 'helioforge-release.apk';
});

await check('release tag matches the tag in release.js', () => {
  const wfTag = /tag_name:\s*(\S+)/.exec(workflow)?.[1];
  const clientTag = /APK_RELEASE_TAG = '([^']+)'/.exec(releaseJs)?.[1];
  assert(wfTag === clientTag, `workflow tag ${wfTag} !== client ${clientTag}`);

  const fileFromTag = /APK_FILE_NAME = '([^']+)'/.exec(releaseJs)?.[1];
  assert(
    wfTag === 'HelioForge-SolarAR-v1.0.0',
    `unexpected tag ${wfTag} — update the download URL in release.js too`
  );
  assert(fileFromTag === 'HelioForge-SolarAR-v1.0.0.apk', `APK_FILE_NAME is ${fileFromTag}`);
  return `${wfTag} → ${fileFromTag}`;
});

await check('CI runs the parity and cloud gates before Gradle', () => {
  const parity = workflow.indexOf('kernel-parity.mjs');
  const cloud = workflow.indexOf('cloud-contract.mjs');
  const gradle = workflow.indexOf('assembleRelease');
  assert(parity > -1 && cloud > -1 && gradle > -1, 'a gate or the build step is missing');
  assert(parity < gradle && cloud < gradle, 'gates run after the build');
  return 'gates precede assembleRelease';
});

/* --------------------------------------------------- one-tap honesty checks */

await check('client never invents a checksum', () => {
  assert(!/SHA256\s*=\s*'[0-9a-f]{64}'/.test(modal), 'hard-coded SHA-256 literal in ApkModal');
  assert(!/[0-9a-f]{64}/.test(modal), 'a 64-hex literal remains in ApkModal');
  return 'no fabricated hash';
});

await check('placeholder (<1 MB) can never be reported as ready', () => {
  assert(/MIN_REAL_APK_BYTES = 1_000_000/.test(releaseJs), 'size floor missing');
  const floor = releaseJs.indexOf('MIN_REAL_APK_BYTES');
  const ready = releaseJs.indexOf("state: 'ready'");
  assert(floor > -1 && ready > floor, 'ready is decided before the size floor');
  assert(/bytes >= MIN_REAL_APK_BYTES/.test(releaseJs), 'ready path does not check size');
  return '1 MB floor enforced';
});

await check('bundled placeholder is below the floor (so it is labelled, not shipped)', () => {
  const rel = 'static/releases/helioforge-release.apk';
  assert(exists(rel), `${rel} missing — run npm run apk:stub`);
  const size = statSync(resolve(root, rel)).size;
  if (size < 1_000_000) {
    return `placeholder ${size} B < 1 MB → UI shows "not published"`;
  }
  const sha = createHash('sha256').update(readFileSync(resolve(root, rel))).digest('hex');
  return `real artifact ${size} B · sha256 ${sha.slice(0, 16)}…`;
});

await check('no duplicate public/releases copy can drift', () => {
  assert(!exists('public/releases'), 'public/releases exists again — static/ is the only asset dir');
  const stub = read('scripts/make-apk-stub.mjs');
  // Allow the explanatory comment, forbid an actual write target.
  assert(!/dir of \['static\/releases', 'public\/releases'\]/.test(stub), 'stub script still writes public/');
  assert(!/writeFileSync\(out, buf\)[\s\S]{0,80}public\/releases/.test(stub), 'stub writes public/');
  return 'single artifact location';
});

await check('mipmap density buckets are consistent with the generator', () => {
  const gen = read('scripts/make-android-icons.py');
  const buckets = [...readdirSync(resolve(root, 'android/app/src/main/res'))]
    .filter((d) => d.startsWith('mipmap-') && d !== 'mipmap-anydpi-v26');
  assert(buckets.length === 5, `expected 5 density buckets, found ${buckets.length}`);
  for (const b of buckets) {
    assert(gen.includes(b.replace('mipmap-', '')), `generator does not know ${b}`);
  }
  return buckets.join(', ');
});

/* ------------------------------------------------- release state machine */

// The modal must never present a 1210-byte placeholder as an installable build.
// Drive resolveRelease() against mocked CDN responses to prove the ladder.
await check('release resolution ladder: placeholder → github → real wins', async () => {
  const { resolveRelease } = await import('../src/lib/apk/release.js');
  const PLACEHOLDER = 1210;
  const REAL = 9_400_000;
  const GH = 'https://github.com/kennedy-blip/helio-forge/releases/latest/download/HelioForge-SolarAR-v1.0.0.apk';

  const withFetch = async (map, fn) => {
    const savedFetch = globalThis.fetch;
    const savedWindow = globalThis.window;
    globalThis.fetch = async (url) => {
      const key = String(url);
      if (!(key in map)) {
        return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
      }
      const size = map[key];
      return {
        ok: true,
        status: 200,
        headers: { get: (h) => (h === 'content-length' ? String(size) : 'application/vnd.android.package-archive') },
        json: async () => ({})
      };
    };
    globalThis.window = { location: { origin: 'https://app.test' } };
    // The module prefers a runtime override over window.location, so pin it.
    globalThis.localStorage = {
      _v: '',
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    };
    try {
      return await fn();
    } finally {
      globalThis.fetch = savedFetch;
      globalThis.window = savedWindow;
    }
  };

  // probe() fetches root-relative paths so the browser resolves them against
  // the page origin; only the reported `url` is absolutised.
  const local = '/releases/helioforge-release.apk';
  const seen = [];

  const a = await withFetch({ [local]: PLACEHOLDER }, () => resolveRelease({ force: true }));
  seen.push(`${a.state}/${a.source}`);
  assert(a.state === 'placeholder', `placeholder misreported as ${a.state}`);

  const b = await withFetch({ [local]: PLACEHOLDER, [GH]: REAL }, () => resolveRelease({ force: true }));
  seen.push(`${b.state}/${b.source}`);
  assert(b.state === 'ready' && b.source === 'github', `GitHub fallback gave ${b.state}/${b.source}`);

  const c = await withFetch({ [local]: REAL }, () => resolveRelease({ force: true }));
  seen.push(`${c.state}/${c.source}`);
  assert(c.state === 'ready' && c.source === 'bundle', `bundled APK gave ${c.state}/${c.source}`);

  const d = await withFetch({}, () => resolveRelease({ force: true }));
  seen.push(`${d.state}/${d.source}`);
  assert(d.state === 'absent', `empty CDN gave ${d.state}`);

  return seen.join(' → ');
});

/* ------------------------------------------------------------------ report */

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok && r.detail ? ` — ${r.detail}` : ''}`);
  if (!r.ok) console.log(`      ${r.detail}`);
}
console.log(`\n${results.length - failed.length}/${results.length} APK release checks passed`);
process.exit(failed.length ? 1 : 0);
