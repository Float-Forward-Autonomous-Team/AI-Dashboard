import { defineConfig } from "vite";

export default defineConfig({
  base: "./", // the build works from any folder on a web server
  server: { port: 5173 },
});
