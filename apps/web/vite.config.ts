import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  envDir: path.resolve(__dirname, '../..'),
  plugins: [
    react(),
    {
      name: 'game-full-reload',
      handleHotUpdate({ file, server }) {
        // Force full page reload for game files — Three.js scene state can't survive HMR
        if (file.includes('/game/') || file.includes('/shared/src/game/')) {
          server.ws.send({ type: 'full-reload' })
          return []
        }
      },
    },
    {
      name: 'serve-lol-assets',
      configureServer(server) {
        // Serve GLB files from assets/lol/ as /lol-assets/
        server.middlewares.use('/lol-assets', (req, res, next) => {
          if (!req.url) return next()
          const assetsDir = path.resolve(__dirname, '../../assets/lol')
          const filePath = path.join(assetsDir, decodeURIComponent(req.url))
          // Security: prevent path traversal
          if (!filePath.startsWith(assetsDir)) return next()
          res.setHeader('Content-Type', 'model/gltf-binary')
          import('fs').then((fs) => {
            const stream = fs.createReadStream(filePath)
            stream.on('error', () => {
              res.statusCode = 404
              res.end('Not found')
            })
            stream.pipe(res)
          })
        })
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
    allowedHosts: true,
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
