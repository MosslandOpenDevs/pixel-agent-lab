import { defineConfig } from "vite";

export default defineConfig({
    server: {
        proxy: {
            "/algora-api": {
                target: "http://localhost:3201",
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/algora-api/, "/api"),
            },
            "/ao-api": {
                target: "http://localhost:3001",
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/ao-api/, ""),
            },
            "/bridge-api": {
                target: "http://localhost:3101",
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/bridge-api/, "/api"),
            },
        },
    },
});
