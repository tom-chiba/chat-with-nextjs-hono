import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// React コンポーネントを jsdom 上で RTL でテストする。
export default defineConfig({
  plugins: [react()],
  resolve: {
    // tsconfig の "@/*" -> "./*" に合わせる。
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
