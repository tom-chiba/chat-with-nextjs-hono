"use client";

import { useEffect } from "react";

// Service Worker を登録するだけのクライアントコンポーネント。
// レンダリング結果を持たず、マウント時に一度だけ /sw.js を登録する。
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // 登録失敗は致命的ではないため握りつぶす（オフライン対応が無効になるのみ）。
      });
    };

    // 初期表示の競合を避けるため load 後に登録する。
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
