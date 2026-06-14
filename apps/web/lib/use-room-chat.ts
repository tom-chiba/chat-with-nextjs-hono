"use client";

import type { ChatMessage, ClientMessage, ServerMessage } from "@repo/shared";
import { useCallback, useEffect, useRef, useState } from "react";

export type ChatStatus = "connecting" | "open" | "closed";

/** API の URL（http/https）から WebSocket の URL（ws/wss）を組み立てる。 */
export function roomWebSocketUrl(roomId: string): string {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
  const wsBase = base.replace(/^http/, "ws");
  return `${wsBase}/ws/room/${encodeURIComponent(roomId)}`;
}

/** 指数バックオフの遅延（ミリ秒）。上限 15 秒。 */
function reconnectDelay(attempts: number): number {
  return Math.min(1000 * 2 ** (attempts - 1), 15_000);
}

/**
 * 指定ルームの WebSocket に接続し、履歴とリアルタイム配信を購読する。
 * セッション Cookie は same-site のためハンドシェイクで自動送信される。
 */
export function useRoomChat(roomId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("connecting");
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let active = true;
    let attempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (!active) return;
      setStatus("connecting");
      const ws = new WebSocket(roomWebSocketUrl(roomId));
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        attempts = 0;
        setStatus("open");
      });

      ws.addEventListener("message", (event) => {
        let data: ServerMessage;
        try {
          data = JSON.parse(event.data as string) as ServerMessage;
        } catch {
          return;
        }
        if (data.type === "history") {
          setMessages(data.messages);
        } else if (data.type === "message") {
          setMessages((prev) => [...prev, data.message]);
        }
      });

      ws.addEventListener("close", () => {
        // roomId 変更などで既に新しいソケットへ張り替わっている場合は、
        // この古いソケットの close で現行 ref を消さない。
        if (wsRef.current === ws) wsRef.current = null;
        if (!active) return;
        setStatus("closed");
        attempts += 1;
        reconnectTimer = setTimeout(connect, reconnectDelay(attempts));
      });

      ws.addEventListener("error", () => {
        ws.close();
      });
    };

    connect();

    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [roomId]);

  const send = useCallback((body: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const msg: ClientMessage = { type: "message", body };
      ws.send(JSON.stringify(msg));
    }
  }, []);

  return { messages, status, send };
}
