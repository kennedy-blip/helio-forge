#!/usr/bin/env node
/**
 * scripts/kernel-parity.mjs
 * Cross-language parity harness: Python 3.12 kernel <-> JS offline mirror.
 *
 * Samples a latitude x day-of-year x hour grid, runs both implementations and
 * asserts every solar-position channel agrees within 0.01 degrees.
 */
import { execFileSync } from 'node:child_process';
import { solarPosition, airMass } from '../src/lib/solar/kernel.js';

const PY = `
import json, sys
sys.path.insert(0, 'src/lib/python')
from helio_kernel import solar_position

lats = [-54.8, -33.9, -1.29, 0.05, 30.27, 45.5, 51.5, 61.2, 69.6, 78.2]
doys = [1, 21, 80, 100, 172, 200, 266, 300, 355, 365]
hours = range(0, 24, 3)
out = []
for lat in lats:
    for doy in doys:
        for h in hours:
            pos = solar_position(lat, 0.0, doy=doy, utc_minutes=h * 60)
            out.append([lat, doy, h, pos['elevation'], pos['azimuth'], pos['declination'], pos['airMass']])
print(json.dumps(out))
`;

const raw = execFileSync('python3', ['-c', PY], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const rows = JSON.parse(raw);

let worstElev = 0;
let worstAz = 0;
let worstDecl = 0;
let worstAirMass = 0;
let failures = 0;

for (const [lat, doy, hour, pyElev, pyAz, pyDecl, pyAm] of rows) {
  const js = solarPosition(lat, 0.0, { doy, utcMinutes: hour * 60 });
  const dElev = Math.abs(js.elevation - pyElev);
  const dAz = Math.abs(((js.azimuth - pyAz + 540) % 360) - 180);
  const dDecl = Math.abs(js.declination - pyDecl);
  const dAm = Math.abs(js.airMass - pyAm);
  worstElev = Math.max(worstElev, dElev);
  worstAz = Math.max(worstAz, dAz);
  worstDecl = Math.max(worstDecl, dDecl);
  worstAirMass = Math.max(worstAirMass, dAm);
  if (dElev > 0.01 || dAz > 0.01 || dDecl > 0.01) {
    failures++;
    if (failures < 6) {
      console.error(
        `MISMATCH lat=${lat} doy=${doy} h=${hour}: dElev=${dElev.toFixed(5)} dAz=${dAz.toFixed(5)} dDecl=${dDecl.toFixed(5)}`
      );
    }
  }
}

console.log(`\nHELIO-FORGE kernel parity — ${rows.length} sampled states`);
console.log(`  max |Δelevation|  ${worstElev.toExponential(2)} °`);
console.log(`  max |Δazimuth|    ${worstAz.toExponential(2)} °`);
console.log(`  max |Δdeclination|${worstDecl.toExponential(2)} °`);
console.log(`  max |Δair mass|   ${worstAirMass.toExponential(2)}`);
console.log(failures === 0 ? '  ✓ PASS — Python and JS kernels agree within 0.01°' : `  ✗ ${failures} states outside tolerance`);
process.exit(failures === 0 ? 0 : 1);
