import type { MetadataRoute } from "next";
import { APP_NAME } from "@repo/shared";

// Web App Manifest（/manifest.webmanifest として配信される）。
// Next.js の metadata ルートで型安全に生成する。
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: "PWA を使った軽量チャットツール",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#4f46e5",
    lang: "ja",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      // セーフゾーン内にバブルを収めた同デザインを maskable としても提供。
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
