import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const API_TARGET = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:8788'
const configuredBasePath = process.env.CELLAR_BASE_PATH?.trim() ?? ''
const basePath = configuredBasePath
  ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}`
  : ''
const viteBase = `${basePath || ''}/`

// Vitest sets this. The Start plugin below wires up SSR, which resolves React
// through the `react-server` condition — under test that yields a React without
// a hooks dispatcher, so component renders die on the first useState.
const isTest = process.env.VITEST === 'true'

const config = defineConfig(({ command }) => ({
  base: viteBase,
  define: {
    __CELLAR_BASE_PATH__: JSON.stringify(basePath),
  },
  // dedupe keeps component tests on a single React instance.
  resolve: { tsconfigPaths: true, dedupe: ['react', 'react-dom'] },
  plugins: [
    // devtools() hangs `vite build` (it does not respect NODE_ENV, which plain
    // `npm run build` never sets anyway); include it only when serving in dev.
    ...(command === 'serve' && !isTest ? [devtools()] : []),
    tailwindcss(),
    // SPA mode: the build emits static files that FastAPI serves directly.
    ...(isTest
      ? []
      : [
          tanstackStart({
            spa: {
              enabled: true,
              maskPath: `${basePath}/history`,
            },
            router: { basepath: basePath || undefined },
            client: { base: basePath || '/' },
          }),
        ]),
    viteReact(),
  ],
  server: {
    port: 3000,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/health': { target: API_TARGET, changeOrigin: true },
    },
  },
}))

export default config
