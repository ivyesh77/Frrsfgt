import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Standalone Vite app for the admin operations center — deliberately never shares a dev
// server, build output, or import graph with the player-facing app (../vite.config.ts).
// The dev proxy below is what lets the browser talk to the admin API as same-origin
// (avoiding any cross-site cookie complication entirely, the same pattern the player app
// already uses for its own backend) while the actual admin API process listens on its own
// independently configurable ADMIN_PORT (see server/src/index.ts).
const ADMIN_API_PORT = process.env.ADMIN_PORT || '8788';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5180,
    strictPort: false,
    allowedHosts: true,
    proxy: {
      '/admin': {
        target: `http://localhost:${ADMIN_API_PORT}`,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
    allowedHosts: true,
  },
});
