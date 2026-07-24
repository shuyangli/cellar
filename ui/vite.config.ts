import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const API_TARGET = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:8788'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    // devtools() hangs `vite build`; it's dev-only anyway.
    ...(process.env.NODE_ENV === 'production' ? [] : [devtools()]),
    tailwindcss(),
    // SPA mode: the build emits static files that FastAPI serves directly.
    tanstackStart({ spa: { enabled: true } }),
    viteReact(),
  ],
  server: {
    port: 3000,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/health': { target: API_TARGET, changeOrigin: true },
    },
  },
})

export default config
