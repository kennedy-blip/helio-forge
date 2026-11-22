#!/usr/bin/env node
/**
 * scripts/make-apk-stub.mjs
 * ----------------------------------------------------------------------------
 * Generates a pre-bundled release placeholder at static/releases/helioforge-release.apk
 * so `/releases/helioforge-release.apk` is NEVER a 404 on the very first Vercel
 * deploy (the master prompt's "guaranteed zero 404s" requirement).
 *
 * The placeholder is a valid ZIP container carrying the build manifest, so the
 * download completes with a real file and the APK Download Center detects that
 * the CI-compiled binary has not landed yet. The GitHub Actions workflow
 * (build-and-bundle-apk.yml) overwrites this file with the real signed APK.
 */
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal stored (no compression) ZIP writer — no dependencies. */
function zip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  const crcTable = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    return table;
  })();

  const crc32 = (buf) => {
    let crc = -1;
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
    return (crc ^ -1) >>> 0;
  };

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const body = Buffer.from(data);
    const crc = crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(body.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, nameBuf]));

    offset += local.length + nameBuf.length + body.length;
  }

  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cdBuf, end]);
}

const manifest = {
  artifact: 'HelioForge-SolarAR-v1.0.0.apk',
  package: 'com.helioforge.solar',
  version: 'v1.0.0-arm64',
  abis: ['arm64-v8a', 'armeabi-v7a'],
  webDir: 'build',
  stack: ['Svelte 5', 'Python 3.12', 'GLSL ES 3.00', 'Kotlin'],
  offlineReady: true,
  pipeline: '.github/workflows/build-and-bundle-apk.yml',
  note:
    'PLACEHOLDER RELEASE BUNDLE. The CI workflow compiles the real signed APK via Gradle ' +
    'and commits it over this file. This archive exists so the one-tap download never 404s.',
  generatedAt: new Date().toISOString()
};

const entries = [
  { name: 'AndroidManifest.xml', data: '<!-- placeholder — real manifest produced by Gradle -->' },
  { name: 'build-manifest.json', data: JSON.stringify(manifest, null, 2) },
  { name: 'META-INF/HELIOFORGE-PLACEHOLDER.txt', data: manifest.note }
];

const buf = zip(entries);

for (const dir of ['static/releases', 'public/releases']) {
  const out = resolve(root, dir, 'helioforge-release.apk');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buf);
}

const sha = createHash('sha256').update(buf).digest('hex');
const size = statSync(resolve(root, 'static/releases/helioforge-release.apk')).size;
console.log(`wrote static/releases/helioforge-release.apk (${size} bytes)`);
console.log(`sha256 ${sha}`);
