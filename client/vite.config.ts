import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss() as any],
  server: {
    proxy: {
      // Proxy /api requests to our backend server
      "/api": {
        target: "http://localhost:3001", // Your backend server URL
        changeOrigin: true, // Recommended for virtual hosted sites
        secure: false, // Optional: Set to false if backend uses self-signed SSL cert
        // rewrite: (path) => path.replace(/^\/api/, '') // Optional: if backend doesn't expect /api prefix
      },
    },
  },
});
