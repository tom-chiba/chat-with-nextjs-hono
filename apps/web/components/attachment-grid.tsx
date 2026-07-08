"use client";

/**
 * グリッドに並べる画像 1 枚。
 *
 * - 実画像: `src`（`href` があればタップで原寸を別タブに開く）。
 * - プレースホルダ: `{ placeholder: true }`。実体を持たないデモ用のダミー表示
 *   （`demo-image` の "image" ラベル）を描く。ゲストデモは API 非依存で実画像を
 *   持たないため、本番と同じレイアウト・グルーピングを共有しつつ中身だけ差し替える。
 */
export type GridImage = { src: string; href?: string } | { placeholder: true };

/**
 * バブル内の画像グリッド（1〜4 枚）。
 *
 * 枚数ごとにレイアウトを変える（1=等倍 / 2=横2分割 / 3=上1+下2 / 4=2×2）。
 * 具体的な配置は CSS 側で `data-count` に応じて切り替える。上限は
 * 1 メッセージ 4 枚のため「+N」表現は持たない。
 */
export function AttachmentGrid({ images }: { images: GridImage[] }) {
  if (images.length === 0) return null;
  return (
    <div className="attach-grid" data-count={Math.min(images.length, 4)}>
      {images.map((img, i) => {
        // key は index で十分（src は都度同じ順、プレースホルダは実体を持たない）。
        if ("placeholder" in img) {
          return (
            <span key={i} className="attach-cell">
              <span className="demo-image">image</span>
            </span>
          );
        }
        const inner = (
          // biome-ignore lint/nursery/noImgElement: 添付は API/blob URL のため next/image は使わない
          <img src={img.src} alt="添付画像" loading="lazy" />
        );
        // 原寸へのリンク有無で分岐する。
        return img.href ? (
          <a
            key={i}
            className="attach-cell"
            href={img.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {inner}
          </a>
        ) : (
          <span key={i} className="attach-cell">
            {inner}
          </span>
        );
      })}
    </div>
  );
}
