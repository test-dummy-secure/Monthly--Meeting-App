import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  if (mode === 'production') {
    if (!env.VITE_API_URL) {
      throw new Error(
        '[BMMJ] VITE_API_URL must be set for production builds.\n' +
        '  Add it to your CI/CD environment or a .env.production file.\n' +
        '  Example: VITE_API_URL=https://api.yourdomain.com/api'
      );
    }
    if (env.VITE_API_URL.includes('localhost') || env.VITE_API_URL.includes('127.0.0.1')) {
      throw new Error(
        `[BMMJ] VITE_API_URL is set to "${env.VITE_API_URL}" which is a development URL.\n` +
        '  Set a production API URL before building for production.'
      );
    }
  }

  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
    },
    build: {
      sourcemap: mode !== 'production',
      minify: 'esbuild',
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom'],
          },
        },
      },
    },
  };
})
