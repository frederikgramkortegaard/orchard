import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
        // Disable timeout to prevent proxy from closing idle websocket connections
        // Without this, the proxy may close the connection before the next heartbeat (30s)
        timeout: 0,
      },
    },
  },
});
