import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// BASE_PATH est fourni par le workflow GitHub Pages ("/<repo>/"), "/" en local ou avec un domaine personnalisé.
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1200,
  },
  test: {
    include: ['src/**/*.test.ts', 'supabase/tests/**/*.test.ts'],
    environment: 'node',
  },
})
