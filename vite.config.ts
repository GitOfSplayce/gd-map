import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// En développement, Vite sert le front et passe /api au serveur (npm run dev:server, port 3600) :
// même origine qu'en production, donc mêmes cookies de session et même adresse de retour OIDC.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:3600' },
  },
  build: {
    chunkSizeWarningLimit: 1200,
  },
  test: {
    include: ['src/**/*.test.ts', 'server/**/*.test.ts', 'db/tests/**/*.test.ts'],
    environment: 'node',
  },
})
