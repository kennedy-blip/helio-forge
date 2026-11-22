/**
 * HELIO-FORGE — global application store (Svelte 5 Runes)
 *
 * A single module-level `$state` object shared by every component. Keeping the
 * whole engineering state in one place means the Python API, the offline JS
 * kernel and the IndexedDB vault all read/write the same source of truth.
 */

import { BATTERY_CHEMISTRY, dayOfYear, optimalTilt, solarPosition } from '$solar/kernel.js';
import { PRESET_SITES } from '$lib/data/sites.js';

const now = new Date();
const startDoy = dayOfYear(now.getFullYear(), now.getMonth() + 1, now.getDate());
const startMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

export const ROLES = [
  {
    id: 'explorer',
    name: 'OFF-GRID EXPLORER / CAMPER',
    tier: 'Standard Tier',
    blurb: 'AR Heliodon · Tilt Clinometer · Power Station Runtime',
    unlocks: ['ar-heliodon', 'clinometer', 'autonomy', 'vault']
  },
  {
    id: 'engineer',
    name: 'SOLAR PV ENGINEER',
    tier: 'Pro Tier',
    blurb: 'Thermal derating · Horizon editor · Quote audit · MPPT sizer',
    unlocks: ['ar-heliodon', 'clinometer', 'autonomy', 'vault', 'thermal', 'horizon-editor', 'quote', 'strings']
  },
  {
    id: 'architect',
    name: 'MICROGRID SYSTEMS ARCHITECT',
    tier: 'Admin Tier',
    blurb: 'Polyglot inspector · GLSL uniforms · Irradiance export · Sync queue',
    unlocks: [
      'ar-heliodon', 'clinometer', 'autonomy', 'vault',
      'thermal', 'horizon-editor', 'quote', 'strings',
      'polyglot', 'glsl-debug', 'export', 'sync-queue'
    ]
  }
];

export const PERMISSIONS = [
  {
    id: 'camera',
    name: 'Optical Sky-Dome Camera',
    api: 'getUserMedia({ video })',
    detail: 'Powers the live AR solar-arc + tree-obstruction overlay.',
    web: 'WebRTC MediaStream',
    native: 'CAMERA + Kotlin HelioSensorPlugin',
    fallback: 'SIMULATOR ACTIVE'
  },
  {
    id: 'orientation',
    name: '3-Axis Clinometer & Geomagnetic Compass',
    api: 'DeviceOrientationEvent',
    detail: 'Measures exact panel tilt (0–90°) and magnetic/true azimuth (0–360°).',
    web: 'DeviceOrientation',
    native: 'TYPE_ROTATION_VECTOR + TYPE_MAGNETIC_FIELD',
    fallback: 'SIMULATOR ACTIVE'
  },
  {
    id: 'geolocation',
    name: 'GPS Ephemeris Coordinates',
    api: 'navigator.geolocation',
    detail: 'Auto-locks latitude/longitude, or pick from 10 offline presets.',
    web: 'W3C Geolocation',
    native: 'FusedLocationProvider',
    fallback: 'PRESET LOCK'
  },
  {
    id: 'haptics',
    name: 'Tactile Alignment Haptic Engine',
    api: 'navigator.vibrate',
    detail: 'Buzzes when you reach ±0.5° of the optimal solar angle.',
    web: 'Vibration API',
    native: 'Vibrator + Capacitor Haptics',
    fallback: 'RESTRICTED'
  },
  {
    id: 'battery',
    name: 'Native Battery Telemetry',
    api: 'BatteryManager',
    detail: 'Voltage, temperature and charge current from Android hardware.',
    web: 'Battery Status API',
    native: 'BatteryManager (Kotlin)',
    fallback: 'SIMULATOR ACTIVE'
  }
];

/** @type {any} */
export const app = $state({
  /* ------------------------------------------------------------- viewport */
  viewport: 'desktop', // 'desktop' | 'mobile'
  activeModule: 'heliodon',
  role: 'engineer',
  theme: 'obsidian',
  booted: false,
  lowGpu: false,
  modal: null, // 'apk' | 'privileges' | 'blueprint' | 'inspector' | null
  modalPayload: null,

  /* ----------------------------------------------------- hardware + perms */
  permissions: {
    camera: false,
    orientation: false,
    geolocation: false,
    haptics: false,
    battery: false
  },
  permissionStatus: {
    camera: 'RESTRICTED',
    orientation: 'SIMULATOR ACTIVE',
    geolocation: 'PRESET LOCK',
    haptics: 'RESTRICTED',
    battery: 'SIMULATOR ACTIVE'
  },
  sensorSource: 'SIMULATOR', // 'NATIVE KOTLIN' | 'WEB ACTIVE' | 'SIMULATOR'

  /* ------------------------------------------------------- site geometry */
  site: { ...PRESET_SITES[0] },
  customSiteName: '',
  latitude: PRESET_SITES[0].lat,
  longitude: PRESET_SITES[0].lon,
  timezoneOffset: PRESET_SITES[0].tz,
  elevationM: PRESET_SITES[0].alt,

  /* --------------------------------------------------------- time scrubber */
  dayOfYear: startDoy,
  minuteOfDay: Math.round(startMinutes),
  timeMode: 'live', // 'live' | 'scrub'
  scrubHour: 12,
  liveSun: { elevation: 0, azimuth: 0 },

  /* ---------------------------------------------------------- panel + PV */
  panel: {
    tilt: 30,
    azimuth: 180,
    kw: 4.2,
    mount: 'roof',
    color: 'dark'
  },
  tiltMode: 'today', // today | fixed | winter | summer | annual
  ambientC: 32,
  windMs: 1.5,
  gamma: -0.38,

  /* ----------------------------------------------------------- heliodon */
  heliodonMode: 'dome', // 'dome' | 'camera'
  showGrid: true,
  showObstruction: true,
  showTiltRing: true,
  arcVisibility: { summer: true, equinox: true, winter: true, today: true },
  horizon: [
    { azimuth: 95, elevation: 4, label: 'East fence' },
    { azimuth: 140, elevation: 9, label: 'Ridge' },
    { azimuth: 205, elevation: 18, label: 'Tall pine at 205°' },
    { azimuth: 240, elevation: 12, label: 'Neighbour roof' },
    { azimuth: 280, elevation: 5, label: 'West wall' }
  ],

  /* ------------------------------------------------- off-grid battery forge */
  battery: {
    chemistry: 'lifepo4',
    capacityAh: 280,
    voltage: 48,
    dodPct: 90,
    inverterPct: 93,
    temperatureC: 18,
    arrayKw: 3.2
  },
  loads: [
    { id: 'fridge', name: 'Energy-Star Fridge', watts: 65, hoursPerDay: 24, on: true, icon: '🧊' },
    { id: 'cpap', name: 'CPAP Machine', watts: 45, hoursPerDay: 8, on: true, icon: '🫁' },
    { id: 'starlink', name: 'Starlink Dish', watts: 55, hoursPerDay: 24, on: true, icon: '📡' },
    { id: 'laptop', name: 'Laptop + Monitor', watts: 90, hoursPerDay: 8, on: true, icon: '💻' },
    { id: 'pump', name: 'Well Pump', watts: 800, hoursPerDay: 1, on: false, icon: '🚰' },
    { id: 'ac', name: 'Mini-Split AC', watts: 950, hoursPerDay: 6, on: false, icon: '❄️' },
    { id: 'lights', name: 'LED Cabin Lights', watts: 24, hoursPerDay: 6, on: true, icon: '💡' },
    { id: 'router', name: 'Mesh Router', watts: 12, hoursPerDay: 24, on: true, icon: '🛜' }
  ],

  /* ----------------------------------------------------- string architect */
  string: {
    panelVoc: 41.2,
    panelVmp: 34.1,
    panelIsc: 11.5,
    panelWatt: 400,
    series: 4,
    parallel: 2,
    controllerMaxVoc: 150,
    mpptLow: 30,
    mpptHigh: 115,
    maxAmps: 100,
    recordLowC: -12
  },

  /* ------------------------------------------------------- quote auditor */
  quote: {
    systemKw: 8.4,
    quotedPrice: 31500,
    promisedKwh: 14200,
    utilityRate: 0.16,
    company: 'SunPeak National',
    clearSkyIndex: 0.72,
    climateLabel: 'Temperate (default)'
  },

  /* --------------------------------------------------- hardware telemetry */
  hardware: {
    batteryPct: 84,
    voltage: 12.87,
    temperatureC: 28.4,
    chargeCurrentMa: -420,
    charging: false
  },

  /* --------------------------------------------------- specular lighting */
  specular: { x: 0, y: 0 },

  /* -------------------------------------------------------- polyglot stats */
  lastKernel: null,
  kernelBench: {
    pythonMs: null,
    jsMs: null,
    wasmMs: null,
    deltaMs: null,
    wasmReady: false,
    wasmMessage: '',
    engine: null,
    source: 'offline'
  },

  /* ------------------------------------------------------------ toasts */
  /** @type {any[]} */
  toasts: []
});

/* ------------------------------------------------------------------ derived */

export function currentRole() {
  return ROLES.find((r) => r.id === app.role) ?? ROLES[0];
}

export function can(feature) {
  return currentRole().unlocks.includes(feature);
}

export function activeLoads() {
  return app.loads.filter((l) => l.on);
}

export function totalLoadWatts() {
  return activeLoads().reduce((sum, l) => sum + l.watts, 0);
}

export function dailyLoadWh() {
  return activeLoads().reduce((sum, l) => sum + l.watts * l.hoursPerDay, 0);
}

export function chemistry() {
  return BATTERY_CHEMISTRY[app.battery.chemistry] ?? BATTERY_CHEMISTRY.lifepo4;
}

/** Live (or scrubbed) sun position at the current site. */
export function sunNow() {
  const minutes = app.timeMode === 'live' ? app.minuteOfDay : app.scrubHour * 60;
  return solarPosition(app.latitude, app.longitude, {
    doy: app.dayOfYear,
    utcMinutes: minutes
  });
}

export function optimalTiltNow(mode = app.tiltMode) {
  return optimalTilt(app.latitude, app.dayOfYear, mode);
}

/* ------------------------------------------------------------------ actions */

export function toast(message, kind = 'info', ttl = 3200) {
  const id = Math.random().toString(36).slice(2, 9);
  app.toasts = [...app.toasts, { id, message, kind }].slice(-4);
  if (typeof window !== 'undefined') {
    setTimeout(() => {
      app.toasts = app.toasts.filter((t) => t.id !== id);
    }, ttl);
  }
  return id;
}

export function setSite(preset) {
  app.site = { ...preset };
  app.latitude = preset.lat;
  app.longitude = preset.lon;
  app.timezoneOffset = preset.tz;
  app.elevationM = preset.alt ?? 0;
}

export function setRole(id) {
  app.role = id;
  toast(`Privilege tier → ${ROLES.find((r) => r.id === id)?.tier}`, 'success');
}

export function openModal(name, payload = null) {
  app.modal = name;
  app.modalPayload = payload;
}

export function closeModal() {
  app.modal = null;
  app.modalPayload = null;
}

export function toggleLoad(id) {
  app.loads = app.loads.map((l) => (l.id === id ? { ...l, on: !l.on } : l));
}

export function haptic(pattern = [12, 40, 12]) {
  if (typeof navigator === 'undefined') return false;
  if (!app.permissions.haptics && app.sensorSource === 'SIMULATOR') {
    // still allow a silent no-op so the simulator feels alive
    return false;
  }
  if (typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(pattern);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
