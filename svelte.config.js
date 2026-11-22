import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    // Hybrid: the whole workstation is statically prerendered so it drops into
    // Vercel's CDN *and* into the Capacitor Android WebView (`webDir: build`).
    // The Python serverless function lives beside the build in /api.
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      precompress: false,
      strict: false
    }),
    prerender: {
      entries: ['*'],
      handleHttpError: 'warn'
    },
    alias: {
      $shaders: 'src/shaders',
      $solar: 'src/lib/solar'
    }
  }
};

export default config;
