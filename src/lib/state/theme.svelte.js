/**
 * HELIO-FORGE — Theme & Field Environment engine
 * Four purpose-built themes, each mapped to CSS custom properties.
 * Svelte 5 runes: the whole object is reactive and readable from any component.
 */

// @ts-nocheck — validated by scripts/kernel-parity.mjs instead of the TS checker

export const THEMES = [
  {
    id: 'obsidian',
    name: 'Solar Obsidian',
    subtitle: 'Deep cosmic slate · default dark glass',
    swatch: ['#090D16', '#F59E0B', '#06B6D4', '#10B981'],
    gpu: 'full',
    icon: '🌌'
  },
  {
    id: 'frost',
    name: 'Desert High-Noon Frost',
    subtitle: 'Alabaster sunlight glass · outdoor readable',
    swatch: ['#F8FAFC', '#F59E0B', '#0EA5E9', '#059669'],
    gpu: 'full',
    icon: '☀️'
  },
  {
    id: 'infrared',
    name: 'Infrared Photovoltaic',
    subtitle: 'FLIR thermal cell mode · UV + magenta',
    swatch: ['#12051F', '#F97316', '#EC4899', '#8B5CF6'],
    gpu: 'full',
    icon: '🔥'
  },
  {
    id: 'eco',
    name: 'Eco-Glass / Low-GPU',
    subtitle: 'Blackout battery saver · locked 60 FPS',
    swatch: ['#06110F', '#14B8A6', '#10B981', '#0E7490'],
    gpu: 'eco',
    icon: '🔋'
  }
];

/** CSS variable bundles. Consumed by +layout.svelte via a `data-theme` attribute. */
export const THEME_VARS = {
  obsidian: {
    '--bg': '#070a12',
    '--bg-deep': '#04060c',
    '--surface': 'rgba(19, 26, 43, 0.58)',
    '--surface-hi': 'rgba(30, 41, 66, 0.74)',
    '--surface-solid': '#0e1522',
    '--border': 'rgba(148, 180, 220, 0.20)',
    '--border-hi': 'rgba(255, 255, 255, 0.34)',
    '--text': '#e8f0fb',
    '--text-dim': '#94a8c4',
    '--text-faint': '#5f7793',
    '--gold': '#F59E0B',
    '--cyan': '#06B6D4',
    '--emerald': '#10B981',
    '--coral': '#F97316',
    '--magenta': '#EC4899',
    '--violet': '#8B5CF6',
    '--prism': 'linear-gradient(135deg, rgba(245,158,11,.42), rgba(255,255,255,.14) 48%, rgba(6,182,212,.38))',
    '--blur': '26px',
    '--shell-tint': 'rgba(7, 10, 18, 0.35)',
    '--shadow': '0 24px 70px -22px rgba(0, 0, 0, 0.85)',
    '--glow-a': 'rgba(245, 158, 11, 0.22)',
    '--glow-b': 'rgba(6, 182, 212, 0.20)'
  },
  frost: {
    '--bg': '#eef4fb',
    '--bg-deep': '#dae6f4',
    '--surface': 'rgba(255, 255, 255, 0.80)',
    '--surface-hi': 'rgba(255, 255, 255, 0.94)',
    '--surface-solid': '#ffffff',
    '--border': 'rgba(15, 42, 74, 0.16)',
    '--border-hi': 'rgba(15, 42, 74, 0.30)',
    '--text': '#0b1a2b',
    '--text-dim': '#3c5670',
    '--text-faint': '#6b8297',
    '--gold': '#B45309',
    '--cyan': '#0369A1',
    '--emerald': '#047857',
    '--coral': '#C2410C',
    '--magenta': '#BE185D',
    '--violet': '#6D28D9',
    '--prism': 'linear-gradient(135deg, rgba(180,83,9,.34), rgba(255,255,255,.85) 48%, rgba(3,105,161,.30))',
    '--blur': '22px',
    '--shell-tint': 'rgba(255, 255, 255, 0.42)',
    '--shadow': '0 20px 55px -26px rgba(15, 42, 74, 0.55)',
    '--glow-a': 'rgba(180, 83, 9, 0.20)',
    '--glow-b': 'rgba(3, 105, 161, 0.18)'
  },
  infrared: {
    '--bg': '#0b0414',
    '--bg-deep': '#060209',
    '--surface': 'rgba(36, 12, 52, 0.62)',
    '--surface-hi': 'rgba(58, 18, 78, 0.78)',
    '--surface-solid': '#1a0a26',
    '--border': 'rgba(236, 72, 153, 0.26)',
    '--border-hi': 'rgba(249, 115, 22, 0.48)',
    '--text': '#fbe9ff',
    '--text-dim': '#c9a3d8',
    '--text-faint': '#8d6ba1',
    '--gold': '#F97316',
    '--cyan': '#22D3EE',
    '--emerald': '#A3E635',
    '--coral': '#FB923C',
    '--magenta': '#EC4899',
    '--violet': '#8B5CF6',
    '--prism': 'linear-gradient(135deg, rgba(249,115,22,.50), rgba(236,72,153,.32) 48%, rgba(139,92,246,.46))',
    '--blur': '24px',
    '--shell-tint': 'rgba(11, 4, 20, 0.42)',
    '--shadow': '0 24px 70px -22px rgba(0, 0, 0, 0.9)',
    '--glow-a': 'rgba(249, 115, 22, 0.26)',
    '--glow-b': 'rgba(236, 72, 153, 0.24)'
  },
  eco: {
    '--bg': '#05100e',
    '--bg-deep': '#030a09',
    '--surface': 'rgba(10, 26, 24, 0.86)',
    '--surface-hi': 'rgba(15, 38, 35, 0.94)',
    '--surface-solid': '#081512',
    '--border': 'rgba(20, 184, 166, 0.24)',
    '--border-hi': 'rgba(20, 184, 166, 0.44)',
    '--text': '#d9f5ef',
    '--text-dim': '#7fbdb2',
    '--text-faint': '#4f8078',
    '--gold': '#34D399',
    '--cyan': '#14B8A6',
    '--emerald': '#10B981',
    '--coral': '#0E7490',
    '--magenta': '#2DD4BF',
    '--violet': '#0E7490',
    '--prism': 'linear-gradient(135deg, rgba(20,184,166,.38), rgba(255,255,255,.06) 48%, rgba(16,185,129,.30))',
    '--blur': '0px',
    '--shell-tint': 'rgba(5, 16, 14, 0.72)',
    '--shadow': '0 0 0 1px rgba(20,184,166,.12)',
    '--glow-a': 'rgba(20, 184, 166, 0.18)',
    '--glow-b': 'rgba(16, 185, 129, 0.14)'
  }
};
