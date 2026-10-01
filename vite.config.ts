import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: true,
    proxy: {
      // The browser only ever talks to this same origin; Vite forwards these
      // server-to-server to the arcade backend so the live preview works
      // without the browser needing to know the backend's real port. `xfwd: true` makes
      // Vite attach X-Forwarded-For/Host/Proto reflecting THIS hop's own incoming
      // connection — combined with the backend's `trust proxy` setting, that's what lets
      // the backend correctly detect whether the original browser request was HTTPS (e.g.
      // behind this sandbox's TLS-terminating preview tunnel) instead of only ever seeing
      // the plain-HTTP connection Vite itself makes to it, which otherwise silently breaks
      // the session cookie's `Secure` attribute.
      '/api': { target: 'http://localhost:8787', changeOrigin: true, xfwd: true },
      '/socket.io': { target: 'http://localhost:8787', ws: true, changeOrigin: true, xfwd: true },
    },
  },
  preview: {
    host: true,
    allowedHosts: true,
  },
})
