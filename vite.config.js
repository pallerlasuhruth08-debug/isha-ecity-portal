import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Relative base so the built app can be served from a GitHub Pages subpath
// (e.g. /isha-ecity-portal/) or from /docs the same way the current PWA is.
// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    react(),
    // injectManifest (not generateSW) because src/sw.js already has hand-written
    // push + notificationclick handlers (Web Push) that must keep working --
    // this just injects the precache list into that same file at build time,
    // rather than generating a whole new service worker that would replace it.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: false, // public/manifest.webmanifest is hand-maintained (GH Pages relative paths)
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
      devOptions: {
        enabled: false, // avoid fighting Vite dev's own module graph; test PWA behavior against `vite build && vite preview`
      },
    }),
  ],
})
