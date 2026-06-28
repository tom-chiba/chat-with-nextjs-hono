import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import "./globals.css";

// 見出し・ワードマーク用のディスプレイ書体（Latin サブセットのみ・軽量）。
// ビルド時の外部ネットワーク依存を避けるためフォントは自前ホストする。
const display = localFont({
  src: "./fonts/schibsted-grotesk-latin.woff2",
  weight: "400 900",
  display: "swap",
  variable: "--font-schibsted",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});
// 接続状態・時刻・未読カウント等「データ」表示用の等幅書体。
const mono = localFont({
  src: "./fonts/geist-mono-latin.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-geist-mono",
  fallback: ["ui-monospace", "monospace"],
});

export const metadata: Metadata = {
  title: "chat-with-nextjs-hono",
  description: "PWA を使った軽量チャットツール",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "chat-with-nextjs-hono",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#2f4fd6" },
    { media: "(prefers-color-scheme: dark)", color: "#161518" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" className={`${display.variable} ${mono.variable}`}>
      <body>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
