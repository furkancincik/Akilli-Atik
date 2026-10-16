import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Keep Auth redirects and PKCE storage on one development origin.
  server: { host: "localhost", port: 5173, strictPort: true },
});
