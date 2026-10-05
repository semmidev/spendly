import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from "@tailwindcss/vite"

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
  build: {
    // No source maps in production — reduces bundle size significantly
    sourcemap: false,
    // Route-level React.lazy splits pages automatically; let the bundler decide
    // shared chunks. A custom manualChunks previously duplicated React across
    // vendor chunks, which caused runtime "undefined is not a function" errors.
    chunkSizeWarningLimit: 1500,
  },
});
