import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: process.env.VERCEL ? '.' : '../',
  build: {
    outDir: process.env.VERCEL ? 'dist' : 'dashboard/dist',
    emptyOutDir: true,
  },
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/giveaway': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
