import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Source tests must also work before the workspace packages are built.
    alias: [{
      find: /^@echoregent\/core$/,
      replacement: fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    }],
  },
  test: {
    // Codex's isolated homes may unpack plugin tests under the benchmark directory.
    // They are external fixtures, not part of EchoRegent's test suite.
    exclude: [...configDefaults.exclude, '.superpowers/**'],
  },
})
