import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifestBase from './manifest.json'
import pkg from './package.json'

// package.json is the single source of truth for the version.
// The manifest.json version field is overridden here at build time so there
// is never a drift between the npm package version and the extension version.
const manifest = {
  ...manifestBase,
  version: pkg.version,
}

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
  ],
  define: {
    // Injected as a build-time string constant — zero runtime overhead.
    // Accessible anywhere in the React app as __APP_VERSION__.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
})
