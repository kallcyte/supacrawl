import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { resolve } from "node:path"

const apiTarget = process.env.API_TARGET ?? "http://127.0.0.1:3456"

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src")
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        ws: true
      },
      "/uploads": {
        target: apiTarget,
        changeOrigin: true,
        ws: true
      }
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: process.env.BUILD_SOURCEMAP === "true" ? "hidden" : false,
    rollupOptions: {
      maxParallelFileOps: 20
    }
  }
})
