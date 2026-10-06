import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(process.cwd(), 'index.html'),
        docs: resolve(process.cwd(), 'docs.html'),
        'use-cases': resolve(process.cwd(), 'use-cases.html'),
      },
    },
  },
})
