import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './src/manifest.config'

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
  },
})
