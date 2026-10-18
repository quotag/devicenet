import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "virtual:pwa-register": fileURLToPath(new URL("./test/pwa-register-stub.ts", import.meta.url)),
    },
  },
  define: { __APP_VERSION__: JSON.stringify("test") },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
  },
});
