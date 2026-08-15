import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // vendor/ holds read-only clones of deepseek-harness and doocs/md for reference.
    // Without an explicit include, vitest discovers and runs both repositories' suites.
    include: ['tests/**/*.test.ts'],
    exclude: ['vendor/**', 'node_modules/**', 'lib/**'],
  },
})
