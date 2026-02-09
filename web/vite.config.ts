import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        presentation: resolve(__dirname, "presentation.html"),
        admin: resolve(__dirname, "admin.html"),
        messages: resolve(__dirname, "messages/index.html")
      }
    }
  },
  server: {
    port: 5173,
    fs: {
      allow: [".."]
    }
  }
});
