import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'game-full-reload',
      handleHotUpdate({ file, server }) {
        // Force full page reload for game files — PixiJS can't survive HMR
        if (file.includes('/game/') || file.includes('/shared/src/game/')) {
          server.ws.send({ type: 'full-reload' })
          return []
        }
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/trpc': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
