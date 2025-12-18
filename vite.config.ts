import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

// Get __dirname equivalent in ES modules
const __dirname = fileURLToPath(new URL('.', import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      stream: resolve(__dirname, 'node_modules/stream-browserify'),
      buffer: resolve(__dirname, 'node_modules/buffer'),
      util: resolve(__dirname, 'node_modules/util'),
      process: resolve(__dirname, 'node_modules/process/browser.js')
    }
  },
  define: {
    'global': 'window',
    'process.env': {}
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis'
      }
    }
  },
  build: {
    commonjsOptions: {
      transformMixedEsModules: true
    }
  }
})
