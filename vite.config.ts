import vue from '@vitejs/plugin-vue';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

const package_json = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')) as {
  version?: string;
};
const package_version = String(package_json.version ?? '');

export default defineConfig(({ mode }) => ({
  define: {
    __TLB_VERSION__: JSON.stringify(package_version),
  },

  plugins: [vue()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },

  build: {
    rollupOptions: {
      input: 'src/index.ts',
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: '[name].[hash].chunk.js',
        assetFileNames: '[name].[ext]',
      },
    },
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: mode === 'production' ? true : 'inline',
    minify: mode === 'production',
    target: 'esnext',
  },
}));
