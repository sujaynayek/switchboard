import { defineConfig, loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const { PORT = '4000' } = loadEnv(mode, root, '');
  const target = 'http://localhost:' + PORT;
  return {
    plugins: [tailwindcss()],
    server: {
      proxy: { '/auth': target, '/api': target, '/ws': { target, ws: true } },
    },
  };
});
