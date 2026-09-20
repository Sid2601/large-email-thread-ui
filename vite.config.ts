import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifestBase from './manifest.json'
import pkg from './package.json'

export default defineConfig(({ mode }) => {
  // Only this explicit mode includes file downloads and diagnostics. Vite's
  // import.meta.env.DEV is false for both optimized release builds.
  const devTools = mode === 'development';
  const manifest = {
    ...manifestBase,
    // package.json is the single source of truth for the extension version.
    version: pkg.version,
    name: devTools ? `${manifestBase.name} Dev` : manifestBase.name,
  }

  return {
    plugins: [react(), crx({ manifest })],
    build: {
      outDir: devTools ? 'dist-dev' : 'dist',
      emptyOutDir: true,
      // Chrome cannot reuse extension preloads across execution worlds.
      modulePreload: false,
      rollupOptions: { input: { offscreen: 'src/offscreen/index.html' } },
    },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __DEV_TOOLS__: JSON.stringify(devTools),
    },
  }
})
