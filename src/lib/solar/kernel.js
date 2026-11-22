/**
 * HELIO-FORGE — localKernel.js
 * ============================================================================
 * Deterministic JavaScript mirror of `src/lib/python/helio_kernel.py`.
 * ============================================================================
 * Runs 100% offline in the browser / Capacitor WebView with zero network calls.
 * Every function here is named for its Python twin so the Polyglot Runtime
 * Inspector can diff the two implementations line by line.
 *
 * Parity is asserted by `npm run check:kernel` (scripts/kernel-parity.mjs)
 * which shells out to Python and compares >200 sampled outputs to < 0.01 deg.
 */
// @ts-nocheck — validated by scripts/kernel-parity.mjs instead of the TS checker

export const SOLAR_CONSTANT = 1367.0;
export const STC_IRRADIANCE = 1000.0;
export const STC_TEMP_C = 25.0;
export const DEG = Math.PI / 180;
const ZIP_ZENITH = 90.833;
export const GAMMA_PMAX_SILICON = -0.38;
export const BETA_VOC_SILICON = -0.29;
export const GAMMA_VMP_SILICON = -0.35;

export const BATTERY_CHEMISTRY = {
  lifepo4: { label: 'LiFePO4', k: 1.02, h: 1.0, dodMax: 0.9, roundTrip: 0.96, cycles: 6000, color: '#10B981' },
  nmc: { label: 'Lithium-Ion NMC', k: 1.03, h: 1.0, dodMax: 0.85, roundTrip: 0.95, cycles: 3000, color: '#06B6D4' },
  agm: { label: 'AGM Lead-Acid', k: 1.15, h: 20.0, dodMax: 0.5, roundTrip: 0.85, cycles: 600, color: '#F59E0B' },
  gel: { label: 'Gel Lead-Acid', k: 1.18, h: 20.0, dodMax: 0.45, roundTrip: 0.82, cycles: 500, color: '#EC4899' }
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const sin = (d) => Math.sin(d * DEG);
const cos = (d) => Math.cos(d * DEG);
const tan = (d) => Math.tan(d * DEG);
const asin = (x) => Math.asin(clamp(x, -1, 1)) / DEG;
const acos = (x) => Math.acos(clamp(x, -1, 1)) / DEG;
export const wrap360 = (d) => ((d % 360) + 360) % 360;
export const wrap180 = (d) => (wrap360(d) > 180 ? wrap360(d) - 360 : wrap360(d));

/* ---------------------------------------------------------------- calendar */

export function dayOfYear(year, month, day) {
  const start = Date.UTC(year, 0, 1);
  const target = Date.UTC(year, month - 1, day);
  return Math.round((target - start) / 86400000) + 1;
}

export function dayToDate(year, doy) {
  const d = new Date(Date.UTC(year, 0, 1) + (clamp(doy, 1, 366) - 1) * 86400000);
  return [d.getUTCMonth() + 1, d.getUTCDate()];
}

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function solarDeclination(doy) {
  const n = doy;
  const g = (2 * Math.PI * (n - 1)) / 365;
  return (
    (0.006918 -
      0.399912 * Math.cos(g) +
      0.070257 * Math.sin(g) -
      0.006758 * Math.cos(2 * g) +
      0.000907 * Math.sin(2 * g) -
      0.002697 * Math.cos(3 * g) +
      0.00148 * Math.sin(3 * g)) *
    (180 / Math.PI)
  );
}

export function equationOfTime(doy) {
  const g = (2 * Math.PI * (doy - 1)) / 365;
  return (
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g))
  );
}

export function eccentricityCorrection(doy) {
  const g = (2 * Math.PI * (doy - 1)) / 365;
  return (
    1.00011 +
    0.034221 * Math.cos(g) +
    0.00128 * Math.sin(g) +
    0.000719 * Math.cos(2 * g) +
    0.000077 * Math.sin(2 * g)
  );
}

function julianDayFromParts(doy, utcMinutes) {
  // 2024 = leap reference year, matches the Python `_jd_from_parts`
  const ms = Date.UTC(2024, 0, 1) + (doy - 1) * 86400000 + utcMinutes * 60000;
  return ms / 86400000 + 2440587.5;
}

/* ------------------------------------------------------- solar position */

export function airMass(elevation) {
  if (elevation <= -0.5) return 40;
  return 1 / (sin(elevation) + 0.50572 * Math.pow(elevation + 6.07995, -1.6364));
}

export function solarPosition(latitude, longitude, { doy, utcMinutes }) {
  const jd = julianDayFromParts(doy, utcMinutes);
  const t = (jd - 2451545.0) / 36525.0;

  const l0 = wrap360(280.46646 + t * (36000.76983 + t * 0.0003032));
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);

  const c =
    sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    sin(2 * m) * (0.019993 - 0.000101 * t) +
    sin(3 * m) * 0.000289;

  const trueLong = l0 + c;
  const omega = 125.04 - 1934.136 * t;
  const appLong = trueLong - 0.00569 - 0.00478 * sin(omega);

  const meanObliq =
    23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * cos(omega);

  const declination = asin(sin(obliq) * sin(appLong));

  const y = tan(obliq / 2) ** 2;
  // NOTE: the polynomial is in radians — convert to degrees before the 4x factor.
  const eot =
    4 *
    ((y * sin(2 * l0) -
      2 * e * sin(m) +
      4 * e * y * sin(m) * cos(2 * l0) -
      0.5 * y * y * sin(4 * l0) -
      1.25 * e * e * sin(2 * m)) *
      180) /
    Math.PI;

  const trueSolarMinutes = (((utcMinutes + eot + 4 * longitude) % 1440) + 1440) % 1440;
  const hourAngle = trueSolarMinutes / 4 - 180;

  const lat = latitude;
  const zenith = acos(sin(lat) * sin(declination) + cos(lat) * cos(declination) * cos(hourAngle));
  const elevation = 90 - zenith;

  const az =
    Math.atan2(sin(hourAngle), cos(hourAngle) * sin(lat) - tan(declination) * cos(lat)) / DEG;
  const azimuth = wrap360(az + 180);

  return {
    elevation,
    zenith,
    azimuth,
    declination,
    hourAngle,
    equationOfTime: eot,
    trueSolarMinutes,
    airMass: airMass(elevation)
  };
}

/** Convenience: local wall-clock hour (fractional) -> UTC minutes. */
export function localHourToUtcMinutes(localHour, longitude, doy) {
  const offsetMin = Math.round(longitude / 15) * 60;
  return (((localHour * 60 - offsetMin) % 1440) + 1440) % 1440 + 0 * doy;
}

export function hourAngleSunrise(latitude, declination) {
  const denom = cos(latitude) * cos(declination);
  if (Math.abs(denom) < 1e-9) return 0;
  const cosH = cos(ZIP_ZENITH) / denom - tan(latitude) * tan(declination);
  if (cosH >= 1) return 0;
  if (cosH <= -1) return 180;
  return acos(cosH);
}

export function daylightHours(latitude, doy) {
  const declination = solarDeclination(doy);
  const h0 = hourAngleSunrise(latitude, declination);
  return { sunriseHourAngle: h0, hours: (2 * h0) / 15, declination };
}

/* ------------------------------------------------------------ optics */

export function optimalTilt(latitude, doy, mode = 'fixed') {
  const lat = Math.abs(latitude);
  switch (mode) {
    case 'today':
      return clamp(lat - solarDeclination(doy), 2, 88);
    case 'winter':
      return clamp(lat + 15, 5, 85);
    case 'summer':
      return clamp(lat - 15, 2, 85);
    case 'annual':
      return clamp(lat * 0.87, 5, 70);
    default:
      return clamp(lat * 0.87, 5, 70);
  }
}

export function incidenceAngle(elevation, sunAzimuth, tilt, panelAzimuth) {
  const cosAoi =
    cos(90 - elevation) * cos(tilt) +
    sin(90 - elevation) * sin(tilt) * cos(sunAzimuth - panelAzimuth);
  return acos(cosAoi);
}

export function cosineEfficiency(elevation, sunAzimuth, tilt, panelAzimuth) {
  return clamp(Math.cos(incidenceAngle(elevation, sunAzimuth, tilt, panelAzimuth) * DEG), 0, 1);
}

/* -------------------------------------------------------- irradiance */

export function clearSkyIrradiance(elevation, altitudeM = 0) {
  if (elevation <= 0.5) return { dni: 0, dhi: 0, ghi: 0, airMass: 40 };
  let am = airMass(elevation) * Math.max(0.6, 1 - 0.0000877 * altitudeM);
  const tauB = 0.7;
  const dni = SOLAR_CONSTANT * Math.pow(tauB, Math.pow(am, 0.678));
  const c = 0.095 + 0.04 * sin(elevation);
  const dhi = c * dni;
  const ghi = dni * sin(elevation) + dhi;
  return { dni, dhi, ghi, airMass: am };
}

export function planeOfArrayIrradiance(
  dni, dhi, ghi, sunZenith, sunAzimuth, tilt, panelAzimuth, albedo = 0.2
) {
  if (dni <= 0 && ghi <= 0) return 0;
  const cosAoi =
    cos(sunZenith) * cos(tilt) + sin(sunZenith) * sin(tilt) * cos(sunAzimuth - panelAzimuth);
  const beam = dni * Math.max(0, cosAoi);
  const sky = (dhi * (1 + cos(tilt))) / 2;
  const ground = (ghi * albedo * (1 - cos(tilt))) / 2;
  return Math.max(0, beam + sky + ground);
}

export function horizonObstructionElevation(pairs, azimuth) {
  if (!pairs || !pairs.length) return 0;
  const az = wrap360(azimuth);
  const p = pairs;
  if (az <= p[0][0] || az >= p[p.length - 1][0]) {
    const left = p[p.length - 1];
    const right = p[0];
    let span = right[0] + 360 - left[0];
    if (span <= 0) return Math.max(left[1], right[1]);
    let t = (az < left[0] ? az + 360 : az) - left[0];
    t = clamp(t / span, 0, 1);
    return left[1] + (right[1] - left[1]) * t;
  }
  for (let i = 0; i < p.length - 1; i++) {
    const [a0, e0] = p[i];
    const [a1, e1] = p[i + 1];
    if (az >= a0 && az <= a1) {
      const span = a1 - a0;
      const t = span <= 0 ? 0 : (az - a0) / span;
      return e0 + (e1 - e0) * t;
    }
  }
  return 0;
}

export function dailyPlaneIrradianceKwh(
  latitude, longitude, doy, tilt, panelAzimuth,
  { stepMinutes = 20, altitudeM = 0, albedo = 0.2, horizon = null } = {}
) {
  let totalWh = 0;
  const pairs = horizon ? horizon.map((h) => [h.azimuth, h.elevation]).sort((a, b) => a[0] - b[0]) : null;
  const step = stepMinutes / 60;
  for (let minute = 0; minute < 1440; minute += stepMinutes) {
    const pos = solarPosition(latitude, longitude, { doy, utcMinutes: minute });
    if (pos.elevation > 0.5) {
      const sky = clearSkyIrradiance(pos.elevation, altitudeM);
      let poa = planeOfArrayIrradiance(
        sky.dni, sky.dhi, sky.ghi, pos.zenith, pos.azimuth, tilt, panelAzimuth, albedo
      );
      if (pairs && pos.elevation <= horizonObstructionElevation(pairs, pos.azimuth)) poa = 0;
      totalWh += poa * step;
    }
  }
  return totalWh / 1000;
}

export function annualIrradianceCurve(latitude, longitude, tilt, panelAzimuth = 180, horizon = null) {
  const curve = [];
  for (let doy = 1; doy <= 365; doy++) {
    const kwhM2 = dailyPlaneIrradianceKwh(latitude, longitude, doy, tilt, panelAzimuth, {
      stepMinutes: 30,
      horizon
    });
    const [month, day] = dayToDate(2025, doy);
    curve.push({ doy, month, day, kwhM2: +kwhM2.toFixed(3) });
  }
  return curve;
}

/* ------------------------------------------ PV yield & thermal derating */

export function cellTemperature(ambientC, poaWm2, windMs = 1, mount = 'roof') {
  const fMount = { roof: 1.15, standoff: 1.0, pole: 0.85, insulated: 1.3 }[mount] ?? 1.0;
  const windFactor = 1 - 0.05 * clamp(windMs, 0, 10);
  return ambientC + ((45 - 20) / 800) * poaWm2 * fMount * windFactor;
}

export function thermalDerating(tCellC, gammaPctPerC = GAMMA_PMAX_SILICON) {
  return 1 + (gammaPctPerC / 100) * (tCellC - STC_TEMP_C);
}

export function pvPower(
  kwStc, poaWm2, tCellC,
  { gammaPctPerC = GAMMA_PMAX_SILICON, soiling = 0.98, mismatch = 0.98, wiring = 0.98, inverter = 0.96 } = {}
) {
  const irradianceFactor = poaWm2 / STC_IRRADIANCE;
  const temperatureFactor = clamp(thermalDerating(tCellC, gammaPctPerC), 0, 1.2);
  const dcKw = kwStc * irradianceFactor * temperatureFactor * soiling * mismatch * wiring;
  return {
    acKw: Math.max(0, dcKw * inverter),
    dcKw: Math.max(0, dcKw),
    irradianceFactor,
    temperatureFactor,
    thermalLossKw: Math.max(0, kwStc * irradianceFactor * (1 - temperatureFactor) * soiling)
  };
}

export function annualYield(
  latitude, longitude, kwStc, tilt, panelAzimuth,
  { ambientC = 25, windMs = 1.5, mount = 'roof', gammaPctPerC = GAMMA_PMAX_SILICON, horizon = null, degradationPctPerYear = 0.5, years = 1, clearSkyIndex = 1 } = {}
) {
  const monthly = new Array(12).fill(0);
  const dailyKwh = [];
  const pairs = horizon ? horizon.map((h) => [h.azimuth, h.elevation]).sort((a, b) => a[0] - b[0]) : null;

  for (let doy = 1; doy <= 365; doy++) {
    let eWh = 0;
    for (let hour = 0; hour < 24; hour++) {
      const pos = solarPosition(latitude, longitude, { doy, utcMinutes: hour * 60 + 30 });
      if (pos.elevation <= 0.5) continue;
      const sky = clearSkyIrradiance(pos.elevation);
      let poa = planeOfArrayIrradiance(
        sky.dni, sky.dhi, sky.ghi, pos.zenith, pos.azimuth, tilt, panelAzimuth
      );
      if (pairs && pos.elevation <= horizonObstructionElevation(pairs, pos.azimuth)) poa = 0;
      poa *= clearSkyIndex;
      const tcell = cellTemperature(ambientC, poa, windMs, mount);
      eWh += pvPower(kwStc, poa, tcell, { gammaPctPerC }).acKw * 1000;
    }
    const [month] = dayToDate(2025, doy);
    monthly[month - 1] += eWh / 1000;
    dailyKwh.push(+(eWh / 1000).toFixed(4));
  }
  const annual = dailyKwh.reduce((a, b) => a + b, 0);
  const projection = [];
  for (let y = 1; y <= Math.max(1, years); y++) {
    projection.push({ year: y, kwh: +(annual * Math.pow(1 - degradationPctPerYear / 100, y - 1)).toFixed(1) });
  }
  return {
    annualKwh: +annual.toFixed(1),
    monthlyKwh: monthly.map((m) => +m.toFixed(1)),
    dailyKwh,
    specificYield: kwStc ? +(annual / kwStc).toFixed(1) : 0,
    peakDayKwh: +Math.max(...dailyKwh, 0).toFixed(1),
    capacityFactor: kwStc ? +(annual / (kwStc * 8760)).toFixed(4) : 0,
    degradationProjection: projection
  };
}

/* --------------------------------------------- off-grid battery autonomy */

export function peukertRuntime(capacityAh, averageCurrentA, k = 1.02, h = 1) {
  if (averageCurrentA <= 0) return { hours: Infinity, deliveredAh: Infinity };
  return {
    hours: h * Math.pow(capacityAh / (averageCurrentA * h), k),
    deliveredAh: averageCurrentA * h * Math.pow(capacityAh / (averageCurrentA * h), k)
  };
}

export function batteryAutonomy(
  chemistry, capacityAh, voltage, loadWatts,
  { dodPct = 80, inverterEfficiencyPct = 92, temperatureC = 25 } = {}
) {
  const chem = BATTERY_CHEMISTRY[chemistry] ?? BATTERY_CHEMISTRY.lifepo4;
  const dod = clamp(dodPct, 5, 100) / 100;
  const etaInv = clamp(inverterEfficiencyPct, 50, 100) / 100;

  let cold = 1;
  if (temperatureC < 25) {
    const drop = /agm|gel/i.test(chem.label) ? 0.01 : 0.004;
    cold = clamp(1 - drop * (25 - temperatureC), 0.55, 1);
  }
  const nominalWh = capacityAh * voltage;
  const usableWh = nominalWh * dod * chem.roundTrip * cold;
  const dcWatts = loadWatts > 0 ? loadWatts / etaInv : 0;
  const drawAmps = voltage ? dcWatts / voltage : 0;
  const peukert = peukertRuntime(capacityAh * dod * cold, drawAmps, chem.k, chem.h);
  let hours = peukert.hours * chem.roundTrip;
  if (drawAmps > 0) hours = Math.min(hours, usableWh / dcWatts);

  return {
    chemistry: chem.label,
    nominalWh: +nominalWh.toFixed(1),
    usableWh: +usableWh.toFixed(1),
    dcLoadWatts: +dcWatts.toFixed(1),
    drawAmps: +drawAmps.toFixed(2),
    peukertExponent: chem.k,
    runtimeHours: Number.isFinite(hours) ? +hours.toFixed(2) : null,
    coldDerate: +cold.toFixed(3),
    chargeEfficiency: chem.roundTrip
  };
}

export function simulateSoc(
  chemistry, capacityAh, voltage, acLoads, arrayKw, tilt, panelAzimuth,
  latitude, longitude, doy,
  { dodPct = 80, inverterEfficiencyPct = 92, initialSocPct = 100, ambientC = 25, horizon = null, hours = 48 } = {}
) {
  const chem = BATTERY_CHEMISTRY[chemistry] ?? BATTERY_CHEMISTRY.lifepo4;
  const dod = clamp(dodPct, 5, 100) / 100;
  const etaInv = clamp(inverterEfficiencyPct, 50, 100) / 100;
  const usableWh = capacityAh * voltage * dod * chem.roundTrip;

  const hourlyLoadAc = new Array(24).fill(0);
  for (const load of acLoads) {
    const watts = +load.watts || 0;
    const hrs = +(load.hoursPerDay ?? 24);
    if (load.startHour == null) {
      for (let h = 0; h < 24; h++) {
        const weight = 1 + 1.6 * Math.exp(-((h - 20) ** 2) / 18);
        hourlyLoadAc[h] += watts * (hrs / 24) * weight;
      }
    } else {
      const start = ((+load.startHour % 24) + 24) % 24;
      const n = Math.ceil(hrs);
      for (let i = 0; i < n; i++) hourlyLoadAc[(start + i) % 24] += (watts / n) * (hrs / n);
    }
  }

  const pairs = horizon ? horizon.map((h) => [h.azimuth, h.elevation]).sort((a, b) => a[0] - b[0]) : null;
  let soc = (clamp(initialSocPct, 0, 100) / 100) * usableWh;
  const samples = [];
  let blackout = null;
  let totalSolarWh = 0;
  let totalLoadWh = 0;

  for (let i = 0; i < hours; i++) {
    const hh = i % 24;
    const pos = solarPosition(latitude, longitude, { doy, utcMinutes: hh * 60 + 30 });
    let poa = 0;
    if (pos.elevation > 0.5) {
      const sky = clearSkyIrradiance(pos.elevation);
      poa = planeOfArrayIrradiance(sky.dni, sky.dhi, sky.ghi, pos.zenith, pos.azimuth, tilt, panelAzimuth);
      if (pairs && pos.elevation <= horizonObstructionElevation(pairs, pos.azimuth)) poa = 0;
    }
    const tcell = cellTemperature(ambientC, poa, 1.5, 'standoff');
    const pv = pvPower(arrayKw, poa, tcell);
    const chargeWh = pv.acKw * 1000 * chem.roundTrip;
    const loadAc = hourlyLoadAc[hh];
    const dischargeWh = loadAc / etaInv;
    totalSolarWh += chargeWh;
    totalLoadWh += dischargeWh;

    soc = Math.min(usableWh, soc + chargeWh - dischargeWh);
    if (soc <= 0 && !blackout) blackout = { hour: i, clock: `${String(hh).padStart(2, '0')}:00`, day: 1 + Math.floor(i / 24) };
    soc = Math.max(0, soc);

    samples.push({
      hour: i,
      clock: `${String(hh).padStart(2, '0')}:00`,
      socPct: usableWh ? +(soc / usableWh * 100).toFixed(2) : 0,
      pvKw: +pv.acKw.toFixed(3),
      loadKw: +(loadAc / 1000).toFixed(3),
      poa: +poa.toFixed(1)
    });
  }

  return {
    samples,
    usableWh: +usableWh.toFixed(1),
    totalSolarKwh: +(totalSolarWh / 1000).toFixed(2),
    totalLoadKwh: +(totalLoadWh / 1000).toFixed(2),
    netKwh: +((totalSolarWh - totalLoadWh) / 1000).toFixed(2),
    survives: blackout === null,
    blackout,
    chemistry: chem
  };
}

/* ----------------------------------- MPPT string sizing (cold Voc spike) */

export function stringSizing({
  panelVoc, panelVmp, panelIsc, panelWatt,
  panelsSeries, stringsParallel,
  controllerMaxVoc, controllerMpptLow, controllerMpptHigh, controllerMaxAmps,
  recordLowC = -15, betaVocPctPerC = BETA_VOC_SILICON, gammaVmpPctPerC = GAMMA_VMP_SILICON,
  conductorDerate = 1.25
}) {
  const beta = betaVocPctPerC / 100;
  const gamma = gammaVmpPctPerC / 100;
  const vocCold = panelVoc * (1 + beta * (recordLowC - STC_TEMP_C));
  const vmpHot = panelVmp * (1 + gamma * (70 - STC_TEMP_C));
  const vocString = vocCold * panelsSeries;
  const vmpStringHot = vmpHot * panelsSeries;
  const iscTotal = panelIsc * stringsParallel * conductorDerate;

  const violations = [];
  const warnings = [];
  if (vocString > controllerMaxVoc) {
    violations.push(
      `COLD-SNAP FAILURE: ${vocString.toFixed(1)} V cold Voc exceeds controller ${controllerMaxVoc.toFixed(0)} V — reduce to ${Math.max(1, Math.floor(controllerMaxVoc / vocCold))} panels in series.`
    );
  } else if (vocString > controllerMaxVoc * 0.9) {
    warnings.push(`Only ${(controllerMaxVoc - vocString).toFixed(1)} V headroom below the controller limit.`);
  }
  if (vmpStringHot < controllerMpptLow) {
    violations.push(
      `HOT-DAY DROPOUT: ${vmpStringHot.toFixed(1)} V hot Vmp is below the ${controllerMpptLow.toFixed(0)} V MPPT floor — add one panel in series.`
    );
  }
  if (vmpStringHot > controllerMpptHigh) warnings.push('Hot Vmp sits above the MPPT window ceiling.');
  if (iscTotal > controllerMaxAmps) {
    violations.push(`CURRENT OVERLOAD: ${iscTotal.toFixed(1)} A (1.25x derated) exceeds a ${controllerMaxAmps.toFixed(0)} A controller.`);
  }

  return {
    panelsSeries,
    stringsParallel,
    arrayWatts: +(panelWatt * panelsSeries * stringsParallel).toFixed(1),
    vocColdPerPanel: +vocCold.toFixed(2),
    vocColdString: +vocString.toFixed(2),
    vmpHotString: +vmpStringHot.toFixed(2),
    iscDerated: +iscTotal.toFixed(2),
    headroomV: +(controllerMaxVoc - vocString).toFixed(2),
    vocMarginPct: +(((controllerMaxVoc - vocString) / controllerMaxVoc) * 100).toFixed(1),
    status: violations.length ? 'FAIL' : warnings.length ? 'CAUTION' : 'PASS',
    violations,
    warnings
  };
}

/* ------------------------------------------- installer quote auditor */

export function auditQuote({
  latitude, longitude, systemKw, quotedPriceUsd, promisedKwhPerYear, utilityRateUsd,
  tilt = null, panelAzimuth = 180, horizon = null, ambientC = 25, clearSkyIndex = 0.72
}) {
  const useTilt = tilt ?? optimalTilt(latitude, 172, 'fixed');
  const model = annualYield(latitude, longitude, systemKw, useTilt, panelAzimuth, {
    ambientC,
    horizon,
    years: 25,
    clearSkyIndex
  });
  const physicsKwh = model.annualKwh;
  const dollarsPerWatt = systemKw ? quotedPriceUsd / (systemKw * 1000) : 0;
  const promisedRatio = physicsKwh ? promisedKwhPerYear / physicsKwh : 0;

  const findings = [];
  let severity = 0;

  if (dollarsPerWatt > 3.2) {
    severity += dollarsPerWatt > 4 ? 2 : 1;
    findings.push({
      id: 'price',
      severity: dollarsPerWatt > 4 ? 'critical' : 'warn',
      title: `$${dollarsPerWatt.toFixed(2)}/W is above the fair-market ceiling`,
      detail: `Fair residential pricing in 2025 is $2.20–$3.20/W. At ${systemKw.toFixed(1)} kW you are paying a $${((dollarsPerWatt - 3.2) * systemKw * 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })} premium. Negotiate toward $${(3.2 * systemKw * 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })}.`
    });
  } else if (dollarsPerWatt < 1.8) {
    findings.push({
      id: 'price-low',
      severity: 'warn',
      title: 'Suspiciously cheap — verify hardware & warranty',
      detail: 'Below $1.80/W usually means refurbished inverters, no labour warranty, or a lease escalation clause.'
    });
  }

  if (promisedRatio > 1.15) {
    severity += promisedRatio > 1.3 ? 2 : 1;
    findings.push({
      id: 'production',
      severity: promisedRatio > 1.3 ? 'critical' : 'warn',
      title: `Promised production is ${(promisedRatio * 100).toFixed(0)}% of a clear-sky physical model`,
      detail: `At lat ${latitude.toFixed(2)}° with ${useTilt.toFixed(0)}° tilt this array physically yields about ${physicsKwh.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh/yr. The quote promises ${promisedKwhPerYear.toLocaleString()} kWh/yr — an overstatement of ${(promisedKwhPerYear - physicsKwh).toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh/yr.`
    });
  } else if (promisedRatio < 0.6) {
    findings.push({
      id: 'production-low',
      severity: 'warn',
      title: 'Quote under-promises production',
      detail: 'Conservative modelling can be legitimate shading avoidance — verify the shade study.'
    });
  }

  if (horizon && horizon.length) {
    const unshaded = annualYield(latitude, longitude, systemKw, useTilt, panelAzimuth, { clearSkyIndex }).annualKwh;
    if (unshaded > 0) {
      const shadeLoss = (unshaded - physicsKwh) / unshaded;
      if (shadeLoss > 0.05) {
        findings.push({
          id: 'shade',
          severity: shadeLoss > 0.15 ? 'warn' : 'info',
          title: `Horizon shading removes ${(shadeLoss * 100).toFixed(1)}% of annual yield`,
          detail: 'Your scanned treeline/roofline profile was applied. Ask the installer to re-price against the shaded yield.'
        });
      }
    }
  }

  const paybackYears = physicsKwh && utilityRateUsd ? quotedPriceUsd / (physicsKwh * utilityRateUsd) : null;
  const lifetimeSavings =
    model.degradationProjection.reduce((a, p) => a + p.kwh, 0) * utilityRateUsd;

  let verdict;
  let verdictClass;
  if (severity >= 3) [verdict, verdictClass] = ['PREDATORY $/WATT OVERCHARGE', 'critical'];
  else if (severity === 2) [verdict, verdictClass] = ['INFLATED PRODUCTION PROMISE', 'critical'];
  else if (severity === 1) [verdict, verdictClass] = ['NEGOTIATE BEFORE SIGNING', 'warn'];
  else [verdict, verdictClass] = ['FAIR ENGINEERING QUOTE', 'ok'];

  return {
    verdict,
    verdictClass,
    dollarsPerWatt: +dollarsPerWatt.toFixed(2),
    benchmarkDollarsPerWatt: { low: 2.2, high: 3.2 },
    physicsKwhPerYear: Math.round(physicsKwh),
    promisedKwhPerYear: Math.round(promisedKwhPerYear),
    realisationRatio: +promisedRatio.toFixed(3),
    specificYield: model.specificYield,
    paybackYears: paybackYears ? +paybackYears.toFixed(1) : null,
    lifetimeSavingsUsd: Math.round(lifetimeSavings),
    year25Kwh: model.degradationProjection.at(-1)?.kwh ?? physicsKwh,
    findings,
    monthlyKwh: model.monthlyKwh,
    assumedTilt: useTilt,
    assumedAzimuth: panelAzimuth,
    clearSkyIndex
  };
}

/* ------------------------------------- heliodon / AR overlay payloads */

export function horizonEfficiency(latitude, longitude, horizon, tilt, panelAzimuth) {
  let unshaded = 0;
  let shaded = 0;
  const monthlyLost = new Array(12).fill(0);
  for (let doy = 1; doy <= 365; doy += 3) {
    const full = dailyPlaneIrradianceKwh(latitude, longitude, doy, tilt, panelAzimuth);
    const part = dailyPlaneIrradianceKwh(latitude, longitude, doy, tilt, panelAzimuth, { horizon });
    unshaded += full;
    shaded += part;
    const [month] = dayToDate(2025, doy);
    monthlyLost[month - 1] += (full - part) * 3;
  }
  return {
    solarWindowEfficiency: unshaded > 0 ? +((shaded / unshaded) * 100).toFixed(1) : 0,
    unshadedKwhM2: +unshaded.toFixed(1),
    shadedKwhM2: +shaded.toFixed(1),
    lostKwhM2: +(unshaded - shaded).toFixed(1),
    monthlyLostKwhM2: monthlyLost.map((v) => +v.toFixed(2))
  };
}

export function solsticeArcs(latitude, longitude, { stepMinutes = 10, todayDoy = null } = {}) {
  const now = new Date();
  const seasons = {
    summer: dayOfYear(2025, 6, 21),
    equinox: dayOfYear(2025, 3, 20),
    winter: dayOfYear(2025, 12, 21),
    today: todayDoy ?? dayOfYear(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate())
  };
  const arcs = {};
  for (const [name, doy] of Object.entries(seasons)) {
    const points = [];
    for (let minute = 0; minute < 1440; minute += stepMinutes) {
      const pos = solarPosition(latitude, longitude, { doy, utcMinutes: minute });
      points.push({
        minute,
        azimuth: +pos.azimuth.toFixed(2),
        elevation: +pos.elevation.toFixed(2),
        up: pos.elevation > 0
      });
    }
    arcs[name] = { dayOfYear: doy, points };
  }
  return arcs;
}

export function ephemerisPayload({
  latitude, longitude, doy, year = 2025, tilt = null, panelAzimuth = 180,
  timezoneOffsetHours = 0, horizon = null, kwStc = 1
}) {
  const useTilt = tilt ?? optimalTilt(latitude, doy, 'fixed');
  const pairs = horizon ? horizon.map((h) => [h.azimuth, h.elevation]).sort((a, b) => a[0] - b[0]) : null;
  const samples = [];
  for (let minute = 0; minute < 1440; minute += 10) {
    const pos = solarPosition(latitude, longitude, { doy, utcMinutes: minute });
    const sky = clearSkyIrradiance(pos.elevation);
    let poa = planeOfArrayIrradiance(sky.dni, sky.dhi, sky.ghi, pos.zenith, pos.azimuth, useTilt, panelAzimuth);
    let obstruction = 0;
    if (pairs) {
      obstruction = horizonObstructionElevation(pairs, pos.azimuth);
      if (pos.elevation <= obstruction) poa = 0;
    }
    const tcell = cellTemperature(25, poa);
    const pv = pvPower(kwStc, poa, tcell);
    samples.push({
      minute,
      localMinute: (minute + timezoneOffsetHours * 60 + 1440) % 1440,
      elevation: +pos.elevation.toFixed(3),
      azimuth: +pos.azimuth.toFixed(3),
      dni: +sky.dni.toFixed(1),
      dhi: +sky.dhi.toFixed(1),
      ghi: +sky.ghi.toFixed(1),
      poa: +poa.toFixed(1),
      powerKw: +pv.acKw.toFixed(4),
      shaded: !!pairs && pos.elevation <= obstruction,
      obstruction: +obstruction.toFixed(2)
    });
  }
  const day = daylightHours(latitude, doy);
  return {
    latitude,
    longitude,
    dayOfYear: doy,
    date: dayToDate(year, doy).reverse().map((n) => String(n).padStart(2, '0')).join('-'),
    declination: +solarDeclination(doy).toFixed(3),
    equationOfTime: +equationOfTime(doy).toFixed(2),
    daylightHours: +day.hours.toFixed(3),
    tilt: +useTilt.toFixed(2),
    panelAzimuth,
    optimalTilt: {
      today: +optimalTilt(latitude, doy, 'today').toFixed(1),
      fixed: +optimalTilt(latitude, doy, 'fixed').toFixed(1),
      winter: +optimalTilt(latitude, doy, 'winter').toFixed(1),
      summer: +optimalTilt(latitude, doy, 'summer').toFixed(1)
    },
    samples,
    peakPoa: +Math.max(...samples.map((s) => s.poa), 0).toFixed(1),
    energyKwh: +(samples.reduce((a, s) => a + s.powerKw, 0) * (10 / 60)).toFixed(3)
  };
}

/* --------------------------------------------------- sun-stage mapping */

export function sunStage(elevation) {
  if (elevation > 45) return { key: 'noon', label: 'Solar Noon · Peak Irradiance', tone: 'gold' };
  if (elevation > 12) return { key: 'day', label: 'Mid-Day Sky', tone: 'cyan' };
  if (elevation > 0) return { key: 'golden', label: 'Golden Hour', tone: 'amber' };
  if (elevation > -6) return { key: 'civil', label: 'Civil Twilight', tone: 'coral' };
  if (elevation > -12) return { key: 'nautical', label: 'Nautical Twilight', tone: 'violet' };
  if (elevation > -18) return { key: 'astronomical', label: 'Astronomical Twilight', tone: 'indigo' };
  return { key: 'night', label: 'Night · Battery Autonomy', tone: 'teal' };
}

export const SUN_STAGE_PALETTES = {
  noon: { top: '#0b3a63', mid: '#06B6D4', horizon: '#F59E0B', glow: '#10B981' },
  day: { top: '#0a2c4d', mid: '#0891B2', horizon: '#F59E0B', glow: '#22D3EE' },
  golden: { top: '#1b1039', mid: '#8B5CF6', horizon: '#F97316', glow: '#EC4899' },
  civil: { top: '#150c2e', mid: '#7C3AED', horizon: '#EC4899', glow: '#F97316' },
  nautical: { top: '#0d0a24', mid: '#4C1D95', horizon: '#8B5CF6', glow: '#14B8A6' },
  astronomical: { top: '#090D16', mid: '#1e1b4b', horizon: '#14B8A6', glow: '#0e7490' },
  night: { top: '#05070d', mid: '#090D16', horizon: '#14B8A6', glow: '#0f766e' }
};
