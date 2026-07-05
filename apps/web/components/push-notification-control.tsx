"use client";

import { useEffect, useState } from "react";
import {
  currentPushSubscription,
  getPushNotificationCapability,
  subscribeToPushNotifications,
  unsubscribeFromPushNotifications,
  type PushNotificationCapability,
} from "@/lib/push-notifications";

type PushStatus = "checking" | "subscribed" | "unsubscribed";

export function PushNotificationControl() {
  const [capability, setCapability] = useState<PushNotificationCapability>("unsupported");
  const [status, setStatus] = useState<PushStatus>("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const nextCapability = getPushNotificationCapability();
    setCapability(nextCapability);
    if (nextCapability !== "supported") {
      setStatus("unsubscribed");
      return;
    }

    currentPushSubscription()
      .then((subscription) => {
        if (active) setStatus(subscription ? "subscribed" : "unsubscribed");
      })
      .catch(() => {
        if (active) setStatus("unsubscribed");
      });
    return () => {
      active = false;
    };
  }, []);

  const subscribe = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await subscribeToPushNotifications();
      setStatus("subscribed");
      setMessage("通知を有効にしました");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "通知の有効化に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const unsubscribe = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await unsubscribeFromPushNotifications();
      setStatus("unsubscribed");
      setMessage("通知を解除しました");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "通知の解除に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || status === "checking" || capability !== "supported";
  const label = status === "subscribed" ? "通知を解除" : busy ? "処理中…" : "通知を有効化";

  return (
    <div className="push-control">
      <button
        type="button"
        onClick={status === "subscribed" ? unsubscribe : subscribe}
        disabled={disabled}
      >
        {label}
      </button>
      {capability === "denied" ? (
        <span className="action-error">ブラウザ設定で通知がブロックされています</span>
      ) : capability === "unsupported" ? (
        <span className="faint" style={{ fontSize: "var(--text-xs)" }}>
          このブラウザは通知に対応していません
        </span>
      ) : message ? (
        <span className="muted" style={{ fontSize: "var(--text-xs)" }}>
          {message}
        </span>
      ) : null}
    </div>
  );
}
