import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // host: true binds the dev server to 0.0.0.0 so other devices (LAN or a public
  // tunnel) can reach it, not just 127.0.0.1 on this machine.
  // proxy: forward all /api/* calls to the backend so the browser only ever
  // talks to the frontend origin. This makes localhost, LAN IP, and tunnel URLs
  // all work without per-device config, and means only port 5173 needs exposing.
  // allowedHosts: true lets tunnel hostnames (*.trycloudflare.com, ngrok, etc.)
  // through Vite's host check.
  server: {
    host: true,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
