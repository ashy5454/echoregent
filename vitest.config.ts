import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Codex's isolated homes may unpack plugin tests under the benchmark directory.
    // They are external fixtures, not part of EchoRegent's test suite.
    exclude: [...configDefaults.exclude, '.superpowers/**'],
  },
})
