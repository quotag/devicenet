import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: ["icon-192.png", "icon-512.png"],
      manifest: {
        name: "DeviceNet",
        short_name: "DeviceNet",
        lang: "vi",
        start_url: "/",
        display: "standalone",
        background_color: "#f6f7f9",
        theme_color: "#2f6bff",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: null,
        globPatterns: ["**/*.{js,css,html,png,woff2}"],
        // Lazy heavy chunks are cached at runtime, not precached (keeps first install small).
        globIgnores: ["**/mqtt.esm-*", "**/PropertyChart-*", "**/index.esm-*", "**/firebase-*"],
        runtimeCaching: [
          { urlPattern: ({ request }) => request.mode === "navigate", handler: "NetworkFirst", options: { cacheName: "pages", networkTimeoutSeconds: 3 } },
          { urlPattern: /\/assets\/.*\.js$/, handler: "CacheFirst", options: { cacheName: "lazy-chunks" } },
        ],
      },
    }),
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "0.0.0") },
  server: { port: 5173 },
});
