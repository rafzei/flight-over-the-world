import { defineConfig } from "vite";

const trafficProxy = () => ({ "/api/traffic": { target: `http://127.0.0.1:${process.env.TRAFFIC_PORT || 3001}`, changeOrigin: true } });

export default defineConfig({
  base: "./",
  server: {
    port: 5173,
    strictPort: true,
    proxy: trafficProxy(),
  },
  preview: { port: 4173, strictPort: true, proxy: trafficProxy() },
});
