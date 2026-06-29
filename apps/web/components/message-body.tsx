"use client";

import { tokenizeMessageBody } from "@repo/shared";

/**
 * メッセージ本文を、テキスト / メンション (`@<name>`) / リンク (`http(s)://...`) に
 * トークン化して描画する。確定済みメッセージ（{@link MessageItem}）と楽観送信中の
 * 保留メッセージ（{@link PendingMessageItem}）で共通の本文表示を担う。
 */
export function MessageBody({ body }: { body: string }) {
  return (
    <>
      {tokenizeMessageBody(body).map((seg, i) => {
        if (seg.type === "mention") {
          return (
            <span key={i} className="mention">
              {seg.value}
            </span>
          );
        }
        if (seg.type === "link") {
          return (
            <a
              key={i}
              href={seg.value}
              target="_blank"
              rel="noopener noreferrer"
              className="msg-link"
            >
              {seg.value}
            </a>
          );
        }
        return seg.value;
      })}
    </>
  );
}
