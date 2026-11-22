/**
 * HELIO-FORGE — 10 offline global solar presets.
 * All coordinates are baked into the bundle so the Wilderness Picker works
 * with zero network access (air-gapped / blackout mode).
 */

// @ts-nocheck — validated by scripts/kernel-parity.mjs instead of the TS checker
export const PRESET_SITES = [
  { id: 'austin', name: 'Austin, TX', region: 'USA · hot-summer humid subtropical', lat: 30.2672, lon: -97.7431, tz: -6, alt: 149, climate: 27 },
  { id: 'anchorage', name: 'Anchorage, AK', region: 'USA · subarctic, midnight sun', lat: 61.2181, lon: -149.9003, tz: -9, alt: 31, climate: 8 },
  { id: 'sahara', name: 'Sahara Solar Array', region: 'Morocco · Ouarzazate desert', lat: 30.9335, lon: -6.9370, tz: 1, alt: 1150, climate: 38 },
  { id: 'alps', name: 'Swiss Alps Off-Grid Cabin', region: 'Switzerland · 1,800 m alpine', lat: 46.0207, lon: 7.7491, tz: 1, alt: 1800, climate: 11 },
  { id: 'tokyo', name: 'Tokyo', region: 'Japan · temperate monsoon', lat: 35.6762, lon: 139.6503, tz: 9, alt: 40, climate: 21 },
  { id: 'nairobi', name: 'Nairobi / Meru', region: 'Kenya · equatorial highland', lat: -0.0463, lon: 37.9062, tz: 3, alt: 1795, climate: 24 },
  { id: 'reykjavik', name: 'Reykjavík', region: 'Iceland · near-polar maritime', lat: 64.1466, lon: -21.9426, tz: 0, alt: 15, climate: 6 },
  { id: 'sydney', name: 'Sydney', region: 'Australia · southern hemisphere', lat: -33.8688, lon: 151.2093, tz: 10, alt: 58, climate: 23 },
  { id: 'quito', name: 'Quito', region: 'Ecuador · equatorial 2,850 m', lat: -0.1807, lon: -78.4678, tz: -5, alt: 2850, climate: 18 },
  { id: 'capetown', name: 'Cape Town', region: 'South Africa · mediterranean', lat: -33.9249, lon: 18.4241, tz: 2, alt: 25, climate: 22 }
];

export const MOUNTS = [
  { id: 'roof', name: 'Flush roof mount', note: 'No air gap · +15% cell heat', factor: 1.15 },
  { id: 'standoff', name: 'Standoff (10 cm gap)', note: 'Baseline NOCT behaviour', factor: 1.0 },
  { id: 'pole', name: 'Pole / ground rack', note: 'Free-air convection', factor: 0.85 },
  { id: 'insulated', name: 'Insulated sandwich', note: 'RV roof over foam · worst case', factor: 1.3 }
];

export const PANEL_COLORS = [
  { id: 'dark', name: 'Obsidian black', absorptivity: 0.94 },
  { id: 'blue', name: 'Poly-crystalline blue', absorptivity: 0.88 },
  { id: 'white', name: 'Bifacial white backsheet', absorptivity: 0.81 }
];

export const STOCK_CONTROLLERS = [
  { id: 'victron-150-70', name: 'Victron SmartSolar 150/70', maxVoc: 150, low: 30, high: 115, amps: 70 },
  { id: 'victron-250-100', name: 'Victron SmartSolar 250/100', maxVoc: 250, low: 40, high: 215, amps: 100 },
  { id: 'renogy-100-50', name: 'Renogy Rover 100V/50A', maxVoc: 100, low: 15, high: 80, amps: 50 },
  { id: 'eg4-500-100', name: 'EG4 500V/100A Hybrid', maxVoc: 500, low: 120, high: 450, amps: 100 }
];
