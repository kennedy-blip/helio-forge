import type { CapacitorConfig } from '@capacitor/cli';

/**
 * HELIO-FORGE — Capacitor Android shell.
 *
 * The SvelteKit build (adapter-static, `build/`) is copied verbatim into the
 * Android WebView, so the whole workstation — including the offline JS/Python
 * kernel mirror, GLSL shaders and the IndexedDB site vault — runs with the
 * radio off in the wilderness.
 */
const config: CapacitorConfig = {
  appId: 'com.helioforge.solar',
  appName: 'HelioForge',
  webDir: 'build',
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: true,
    backgroundColor: '#070a12'
  },
  server: {
    androidScheme: 'https',
    hostname: 'helioforge.local',
    // Never load a remote URL: the APK is a fully self-contained offline app.
    cleartext: false
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 900,
      backgroundColor: '#070a12',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#070a12',
      overlaysWebView: true
    }
  }
};

export default config;
