import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base so the built app can be served from a GitHub Pages subpath
// (e.g. /isha-ecity-portal/) or from /docs the same way the current PWA is.
// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
})
