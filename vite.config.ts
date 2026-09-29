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
      // without the browser needing to know the backend's real port.
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:8787', ws: true, changeOrigin: true },
    },
  },
  preview: {
    host: true,
    allowedHosts: true,
  },
})
