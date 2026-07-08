"use client";

import type { ChatMessage, ClientMessage } from "@repo/shared";
import { HISTORY_LIMIT, MESSAGE_PAGE_SIZE, serverMessageSchema } from "@repo/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiWebSocketUrl } from "@/lib/api-base";
import { compareMessages, mergeMessages } from "@/lib/messages";
import { fetchMessages } from "@/lib/rooms";

export type ChatStatus = "connecting" | "open" | "closed";

/**
 * 楽観送信の保留状態。
 * - `sending`: ソケットへ送出済みで ack（ブロードキャスト）待ち。
 * - `queued`: 切断中に積まれ、再接続時の flush 待ち（まだ送出していない）。
 * - `failed`: レート制限などで拒否、または送出中に切断され宙に浮いた。再送 / 破棄できる。
 */
export type PendingStatus = "sending" | "queued" | "failed";

/** 楽観表示中の添付プレビュー。送信中バブルに出す（ローカルの object URL）。 */
export type PendingAttachment = {
  /** `URL.createObjectURL` で作ったプレビュー URL。 */
  previewUrl: string;
  mimeType: string;
};

/** 楽観表示中のメッセージ。サーバ採番前なので相関キー `nonce` で同定する。 */
export type PendingMessage = {
  nonce: string;
  body: string;
  status: PendingStatus;
  /** 表示順用のローカル時刻（ミリ秒エポック）。常に既存メッセージ末尾の後ろへ並べる。 */
  createdAt: number;
  /** アップロード済み添付の id。再送時にそのまま載せ直す。 */
  attachmentIds?: string[];
  /** 送信中バブルに表示する添付プレビュー。 */
  attachments?: PendingAttachment[];
};

/** ルームの WebSocket URL を組み立てる。 */
export function roomWebSocketUrl(roomId: string): string {
  return apiWebSocketUrl(`/ws/room/${encodeURIComponent(roomId)}`);
}

/** 保留メッセージが持つプレビュー object URL を解放する（確定・破棄・失敗破棄時）。 */
function revokePendingPreviews(p: PendingMessage): void {
  for (const a of p.attachments ?? []) URL.revokeObjectURL(a.previewUrl);
}

/** 指数バックオフの遅延（ミリ秒）。上限 15 秒。 */
function reconnectDelay(attempts: number): number {
  return Math.min(1000 * 2 ** (attempts - 1), 15_000);
}

/** メッセージ送信ペイロードを組み立てて送出する（send / retry / flush の単一経路）。 */
function sendClientMessage(
  ws: WebSocket,
  body: string,
  nonce: string,
  attachmentIds?: string[],
): void {
  ws.send(
    JSON.stringify({
      type: "message",
      body,
      nonce,
      ...(attachmentIds && attachmentIds.length > 0 ? { attachmentIds } : {}),
    } satisfies ClientMessage),
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
  /** 楽観送信の保留リスト。サーバ真実の messages とは分離し、描画時に末尾へ連結する。 */
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  /** 最新の messages を同期保持し、コールバックから最新値を読むためのミラー。 */
  const messagesRef = useRef<ChatMessage[]>([]);
  /** 最新の pending を同期保持し、open/close ハンドラから最新値を読むためのミラー。 */
  const pendingRef = useRef<PendingMessage[]>([]);
  /** loadOlder の二重実行防止（描画に依らず即時に判定するため ref で持つ）。 */
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

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
        // boundary（再接続前の最新）に到達したら欠落区間をカバー済み。
        if (compareMessages(oldestPage, boundary) <= 0) return;
        // これ以上履歴がない、またはカーソルが前進しないなら停止。
        if (page.length < MESSAGE_PAGE_SIZE) return;
        if (oldestPage.createdAt === cursor.createdAt && oldestPage.id === cursor.id) return;
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
        // 切断中に積まれた queued を再接続時に送出する。queued は未送出のため
        // 再送しても重複は生じない（sending は close 時に failed へ倒すので含まれない）。
        const toFlush = pendingRef.current.filter((p) => p.status === "queued");
        if (toFlush.length > 0) {
          for (const p of toFlush) sendClientMessage(ws, p.body, p.nonce, p.attachmentIds);
          const flushed = new Set(toFlush.map((p) => p.nonce));
          setPending((prev) =>
            prev.map((p) => (flushed.has(p.nonce) ? { ...p, status: "sending" } : p)),
          );
        }
      });

      ws.addEventListener("message", (event) => {
        let raw: unknown;
        try {
          raw = JSON.parse(event.data as string);
        } catch {
          return;
        }
        // スキーマで実検証し、破損・想定外のデータは安全に無視する。
        const parsed = serverMessageSchema.safeParse(raw);
        if (!parsed.success) return;
        const data = parsed.data;
        if (data.type === "history") {
          const prev = messagesRef.current;
          const incoming = data.messages;
          // 全置換せずマージし、再接続時に旧表示の前方が落ちないようにする。
          setMessages((m) => mergeMessages(m, incoming));
          // 初回履歴（最新 HISTORY_LIMIT 件）が上限未満なら、これ以上古い履歴は
          // 存在しないので過去ログ読み込みを無効化する。再接続時の history 再送で
          // loadOlder 済みの hasMore を巻き戻さないよう、初回（prev が空）に限る。
          if (prev.length === 0) setHasMore(incoming.length >= HISTORY_LIMIT);
          // history（直近 N 件）が旧最新と重ならない場合は欠落区間を補完する。
          // 比較は (createdAt, id) 複合で行い、同一ミリ秒境界の取りこぼしを防ぐ。
          const newestPrev = prev[prev.length - 1];
          const oldestIncoming = incoming[0];
          if (newestPrev && oldestIncoming && compareMessages(oldestIncoming, newestPrev) > 0) {
            void backfillGap(newestPrev, oldestIncoming);
          }
        } else if (data.type === "message") {
          setMessages((prev) => mergeMessages(prev, [data.message]));
          // 自分の送信のエコーなら、対応する保留を確定（除去）する。
          if (data.nonce) {
            const confirmed = data.nonce;
            // 確定した保留のプレビュー URL を解放（確定後は配信画像を参照するため不要）。
            const done = pendingRef.current.find((p) => p.nonce === confirmed);
            if (done) revokePendingPreviews(done);
            setPending((prev) => prev.filter((p) => p.nonce !== confirmed));
          }
        } else if (data.type === "update") {
          // 編集 / 論理削除。既存メッセージを id でマッチして差し替える。
          // 未ロード（表示範囲外）の id は無視し、孤立挿入しない。
          setMessages((prev) => prev.map((m) => (m.id === data.message.id ? data.message : m)));
        } else if (data.type === "error") {
          // nonce が一致する保留があれば失敗扱いにし、本文を保持して再送可能にする。
          // 失敗理由は従来どおりバナーにも出す（個別バブルの再送導線と併用）。
          setErrorMessage(data.message);
          if (data.nonce) {
            const failed = data.nonce;
            setPending((prev) =>
              prev.map((p) => (p.nonce === failed ? { ...p, status: "failed" } : p)),
            );
          }
        }
      });

      ws.addEventListener("close", () => {
        // roomId 変更などで既に新しいソケットへ張り替わっている場合は、
        // この古いソケットの close で現行 ref を消さない。
        if (wsRef.current === ws) wsRef.current = null;
        if (!active) return;
        setStatus("closed");
        // 送出済み（sending）は ack 前に切断され宙に浮いた。自動再送はサーバが
        // id を都度採番し重複投稿になり得るため、failed にして手動再送に委ねる。
        setPending((prev) =>
          prev.map((p) => (p.status === "sending" ? { ...p, status: "failed" } : p)),
        );
        attempts += 1;
        // error → close の二重発火など、複数 close で前のタイマーが参照を失って
        // リークし再接続が重複しないよう、スケジュール前に必ず clear する。
        if (reconnectTimer) clearTimeout(reconnectTimer);
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

  const send = useCallback(
    (body: string, opts?: { attachmentIds?: string[]; attachments?: PendingAttachment[] }) => {
      const ws = wsRef.current;
      const isOpen = ws?.readyState === WebSocket.OPEN;
      const attachmentIds = opts?.attachmentIds;
      // 送信時にエラー表示を消す（新たなレート制限が来たら setErrorMessage で再表示）。
      setErrorMessage(null);
      const nonce = crypto.randomUUID();
      // 楽観表示。OPEN なら即送出して sending、切断中は queued で積み再接続時に flush。
      setPending((prev) => [
        ...prev,
        {
          nonce,
          body,
          status: isOpen ? "sending" : "queued",
          createdAt: Date.now(),
          attachmentIds,
          attachments: opts?.attachments,
        },
      ]);
      if (isOpen && ws) sendClientMessage(ws, body, nonce, attachmentIds);
    },
    [],
  );

  /** 失敗 / 保留中のメッセージを再送する。OPEN なら即送出、切断中は queued に戻す。 */
  const retry = useCallback((nonce: string) => {
    const target = pendingRef.current.find((p) => p.nonce === nonce);
    if (!target) return;
    const ws = wsRef.current;
    const isOpen = ws?.readyState === WebSocket.OPEN;
    setErrorMessage(null);
    if (isOpen && ws) sendClientMessage(ws, target.body, nonce, target.attachmentIds);
    setPending((prev) =>
      prev.map((p) => (p.nonce === nonce ? { ...p, status: isOpen ? "sending" : "queued" } : p)),
    );
  }, []);

  /** 保留中のメッセージを破棄する（再送せず取り下げる）。 */
  const discard = useCallback((nonce: string) => {
    const target = pendingRef.current.find((p) => p.nonce === nonce);
    if (target) revokePendingPreviews(target);
    setPending((prev) => prev.filter((p) => p.nonce !== nonce));
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
    pending,
    status,
    send,
    retry,
    discard,
    errorMessage,
    clearError,
    loadOlder,
    hasMore,
    loadingMore,
  };
}
