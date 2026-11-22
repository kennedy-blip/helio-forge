<script>
  /**
   * Dependency-free QR code renderer (qrcode-generator, MIT) -> crisp inline SVG.
   */
  import qrcode from 'qrcode-generator';

  let { value = '', size = 180, dark = '#05080e', light = '#ffffff' } = $props();

  /** @type {{count: number, cells: {r: number, x: number, w: number}[]}} */
  const qr = $derived.by(() => {
    const model = qrcode(0, 'M');
    model.addData(value || 'https://helioforge.app');
    model.make();
    const count = model.getModuleCount();
    /** @type {{r: number, x: number, w: number}[]} */
    const cells = [];
    // Merge horizontal runs into single <rect>s so the SVG stays tiny.
    for (let r = 0; r < count; r++) {
      let runStart = null;
      for (let c = 0; c <= count; c++) {
        const on = c < count && model.isDark(r, c);
        if (on && runStart === null) runStart = c;
        if (!on && runStart !== null) {
          cells.push({ r, x: runStart, w: c - runStart });
          runStart = null;
        }
      }
    }
    return { count, cells };
  });
</script>

<svg
  viewBox={`0 0 ${qr.count} ${qr.count}`}
  width={size}
  height={size}
  class="qr"
  role="img"
  aria-label="QR code to install the HelioForge APK"
  shape-rendering="crispEdges"
>
  <rect width={qr.count} height={qr.count} fill={light} rx="1.4" />
  {#each qr.cells as cell (cell.r + ':' + cell.x)}
    <rect x={cell.x} y={cell.r} width={cell.w} height="1" fill={dark} />
  {/each}
</svg>

<style>
  .qr {
    display: block;
    border-radius: 12px;
    box-shadow: 0 10px 30px -12px rgba(0, 0, 0, 0.6);
  }
</style>
