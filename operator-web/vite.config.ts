import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const OPERATOR_API_PORT = process.env.OPERATOR_PORT || '8789';
export default defineConfig({ plugins: [react()], server: { host: true, port: 5190, strictPort: false, allowedHosts: true, proxy: { '/operator': { target: `http://localhost:${OPERATOR_API_PORT}`, changeOrigin: true, xfwd: true } } }, preview: { host: true, allowedHosts: true } });
