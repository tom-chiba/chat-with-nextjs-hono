"use client";

/**
 * ルーム一覧ペインとチャットペインを収める 2 ペインのシェル。
 *
 * デスクトップでは常設サイドバー + チャットの 2 カラム、モバイルではルーム一覧を
 * ドロワーとして開閉する。ログイン後（{@link Home}）とゲストデモで同じ構造・挙動を
 * 共有するための presentational ラッパ。ペイン（`.roomlist-pane` / `.chat-pane`）は
 * children として受け取る。
 */
export function AppShell({
  drawerOpen,
  onCloseDrawer,
  children,
}: {
  /** モバイルのルーム一覧ドロワーが開いているか。デスクトップでは常設のため無視される。 */
  drawerOpen: boolean;
  /** ドロワー背面のクリックで呼ばれる（ドロワーを閉じる）。 */
  onCloseDrawer: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="app-shell" data-drawer={drawerOpen ? "open" : "closed"}>
      {/* モバイルのドロワー背面。開いている間だけ描画し、クリックで閉じる。 */}
      {drawerOpen && (
        <button
          type="button"
          className="drawer-backdrop mobile-only"
          aria-label="ルーム一覧を閉じる"
          onClick={onCloseDrawer}
        />
      )}
      {children}
    </div>
  );
}
