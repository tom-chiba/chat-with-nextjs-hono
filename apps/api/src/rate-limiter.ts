import { WS_RATE_LIMIT_MAX, WS_RATE_LIMIT_WINDOW_MS } from "@repo/shared";

/**
 * ユーザーごとのスライディングウィンドウ・レート制限。
 *
 * `windowMs` 内に `max` 件を超える許可要求を拒否する。状態は in-memory（Map）で持つため、
 * 単一インスタンス（1 ルーム = 1 Durable Object）での利用を前提とする。副作用を持たない
 * 純クラスなので単体テスト可能。
 */
export class RateLimiter {
  /** ユーザーごとの直近許可時刻（ミリ秒エポック）の履歴。 */
  private readonly recentByUser = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number = WS_RATE_LIMIT_WINDOW_MS,
    private readonly max: number = WS_RATE_LIMIT_MAX,
  ) {}

  /**
   * `userId` がウィンドウ内の上限に達していなければ true を返し、同時に `now` を履歴へ記録する。
   * 呼び出しごとに期限切れの時刻を間引いて書き戻すため、各ユーザーの履歴は高々 `max` 件、
   * Map のキーも実質ルームの送信者数に収まり、際限なく伸びることはない。
   */
  allow(userId: string, now: number): boolean {
    const cutoff = now - this.windowMs;
    const recent = (this.recentByUser.get(userId) ?? []).filter((t) => t > cutoff);

    if (recent.length >= this.max) {
      this.recentByUser.set(userId, recent);
      return false;
    }

    recent.push(now);
    this.recentByUser.set(userId, recent);
    return true;
  }
}
