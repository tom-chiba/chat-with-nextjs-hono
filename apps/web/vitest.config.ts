import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// React コンポーネントを jsdom 上で RTL でテストする。
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
