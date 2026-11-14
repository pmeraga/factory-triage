import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], build: { outDir: 'dist-client', cssCodeSplit: false, assetsInlineLimit: 100000 }, server: { host: '127.0.0.1' } });
