// オフライン時に Service Worker がナビゲーションのフォールバックとして返す静的ページ。
// 動的データ（セッション・ルーム）には触れず、最小限の案内のみを表示する。
export const metadata = {
  title: "オフライン",
};

export default function Offline() {
  return (
    <main style={{ padding: 24, display: "grid", gap: 12 }}>
      <h1>オフラインです</h1>
      <p>
        ネットワークに接続できませんでした。接続が回復したら、ページを再読み込みしてください。
      </p>
    </main>
  );
}
