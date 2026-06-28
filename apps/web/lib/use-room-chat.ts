"use client";

import type { ChatMessage, ClientMessage, ServerMessage } from "@repo/shared";
import { MESSAGE_PAGE_SIZE } from "@repo/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchMessages } from "@/lib/rooms";

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
 * 既存メッセージへ受信分を id で一意化しながらマージし、
 * `(createdAt, id)` 昇順（サーバのソート規則と同じ）で返す。
 * 同一 id は受信分（incoming）を優先し、編集・削除の最新版を反映する。
 */
export function mergeMessages(
  existing: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] {
  if (incoming.length === 0) return existing;
  const byId = new Map<string, ChatMessage>();
  for (const m of existing) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].toSorted(
    (a, b) =>
      a.createdAt - b.createdAt ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/**
 * 指定ルームの WebSocket に接続し、履歴とリアルタイム配信を購読する。
 * セッション Cookie は same-site のためハンドシェイクで自動送信される。
 *
 * メッセージはライブ（WS）と過去ログ（REST）を区別せず単一リストで一元管理し、
 * 受信のたびに id で一意化・時系列ソートする。これにより再接続時の `history`
 * 全置換による歯抜けを防ぎ、`history` が旧表示と重ならない場合は欠落区間を
 * REST で補完する。
 *
 * 親は `key={roomId}` で利用側を再マウントしてルーム切替時に状態を初期化する前提。
 */
export function useRoomChat(roomId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("connecting");
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  /** サーバから来た最新のエラーメッセージ（レート制限など）。next send で自然に上書きされる。 */
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  /** 最新の messages を同期保持し、コールバックから最新値を読むためのミラー。 */
  const messagesRef = useRef<ChatMessage[]>([]);
  /** loadOlder の二重実行防止（描画に依らず即時に判定するため ref で持つ）。 */
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    let active = true;
    let attempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    /**
     * 再接続時の欠落区間を REST で補完する。`boundary`（再接続前の最新）に達するまで
     * `cursor` から古い方向へページングし、取得分をマージする。
     */
    const backfillGap = async (boundary: ChatMessage, from: ChatMessage) => {
      let cursor = from;
      // 安全上限。1 ページ MESSAGE_PAGE_SIZE 件なので通常は数ページで収束する。
      for (let i = 0; i < 50; i++) {
        if (!active) return;
        let page: ChatMessage[];
        try {
          page = await fetchMessages(roomId, {
            createdAt: cursor.createdAt,
            id: cursor.id,
          });
        } catch {
          // 失敗時は諦める（次の再接続や loadOlder で回復余地がある）。
          return;
        }
        if (!active || page.length === 0) return;
        setMessages((prev) => mergeMessages(prev, page));
        const oldestPage = page[0];
        if (!oldestPage) return;
        // boundary の時刻に到達したら欠落区間をカバー済み。
        if (oldestPage.createdAt <= boundary.createdAt) return;
        // これ以上履歴がない、またはカーソルが前進しないなら停止。
        if (page.length < MESSAGE_PAGE_SIZE) return;
        if (
          oldestPage.createdAt === cursor.createdAt &&
          oldestPage.id === cursor.id
        )
          return;
        cursor = oldestPage;
      }
    };

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
          const prev = messagesRef.current;
          const incoming = data.messages;
          // 全置換せずマージし、再接続時に旧表示の前方が落ちないようにする。
          setMessages((m) => mergeMessages(m, incoming));
          // history（直近 N 件）が旧最新と重ならない場合は欠落区間を補完する。
          const newestPrev = prev[prev.length - 1];
          const oldestIncoming = incoming[0];
          if (
            newestPrev &&
            oldestIncoming &&
            oldestIncoming.createdAt > newestPrev.createdAt
          ) {
            void backfillGap(newestPrev, oldestIncoming);
          }
        } else if (data.type === "message") {
          setMessages((prev) => mergeMessages(prev, [data.message]));
        } else if (data.type === "update") {
          // 編集 / 論理削除。既存メッセージを id で一意化して差し替える。
          setMessages((prev) => mergeMessages(prev, [data.message]));
        } else if (data.type === "error") {
          setErrorMessage(data.message);
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
      // 送信時にエラー表示を消す（新たなレート制限が来たら setErrorMessage で再表示）。
      setErrorMessage(null);
      const msg: ClientMessage = { type: "message", body };
      ws.send(JSON.stringify(msg));
    }
  }, []);

  /** 現在の先頭より古いメッセージを REST で 1 ページ取得してマージする。 */
  const loadOlder = useCallback(async () => {
    if (loadingMoreRef.current) return;
    const oldest = messagesRef.current[0];
    if (!oldest) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await fetchMessages(roomId, {
        createdAt: oldest.createdAt,
        id: oldest.id,
      });
      setMessages((prev) => mergeMessages(prev, page));
      if (page.length < MESSAGE_PAGE_SIZE) setHasMore(false);
    } catch {
      // 取得失敗時はボタンを残し、再試行できるようにする。
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [roomId]);

  const clearError = useCallback(() => setErrorMessage(null), []);

  return {
    messages,
    status,
    send,
    errorMessage,
    clearError,
    loadOlder,
    hasMore,
    loadingMore,
  };
}
