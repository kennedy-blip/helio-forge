<script>
  /** Global 3.5% feTurbulence film-grain — the frosted-quartz tactile finish. */
</script>

<svg class="noise-overlay" aria-hidden="true" focusable="false">
  <filter id="helio-grain">
    <feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="4" stitchTiles="stitch" />
    <feColorMatrix type="saturate" values="0" />
    <feComponentTransfer>
      <feFuncA type="linear" slope="1" />
    </feComponentTransfer>
  </filter>
  <rect width="100%" height="100%" filter="url(#helio-grain)" />
</svg>

<style>
  .noise-overlay {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 50;
    pointer-events: none;
    opacity: 0.035;
    mix-blend-mode: overlay;
  }
</style>
