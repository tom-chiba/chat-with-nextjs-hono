import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 共有パッケージ（素の TypeScript を公開）をトランスパイル対象にする。
  transpilePackages: ["@repo/shared"],
};

export default nextConfig;
