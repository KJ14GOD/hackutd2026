import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { githubAuth } from './server/githubAuth';
import { dataApi } from './server/api';

export default defineConfig(({ mode }) => {
  // '' loads every variable in .env, not just VITE_ ones; the GitHub secret never goes to the browser.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), githubAuth(env), dataApi()],
    server: { port: 5173, strictPort: true },
  };
});
