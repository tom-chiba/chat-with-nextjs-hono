import { defineConfig } from "vitest/config";

// 純粋な TS の共有パッケージ。Node 環境で実行する。
export default defineConfig({
  test: {
    environment: "node",
  },
});
