import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'
import { slackApi } from './server/slack.ts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Secrets live in the repo-root .env; '' loads all of them, and they stay on the dev server.
  const env = loadEnv(mode, fileURLToPath(new URL('..', import.meta.url)), '')
  return {
    plugins: [react(), tailwindcss(), slackApi(env)],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  }
})
