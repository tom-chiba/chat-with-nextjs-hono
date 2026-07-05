"use client";

import { useEffect, useState } from "react";

/**
 * ポインタが coarse（タッチ主体＝スマホ等）かどうかを返す。
 *
 * PC（マウス）は fine、スマホ・多くのタブレットは coarse になる。
 * SSR とテスト（jsdom は matchMedia 未実装）では false（PC 想定）を返し、
 * マウント後に実際の値へ更新する。外付けポインタ切替にも change で追従する。
 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(pointer: coarse)");
    setCoarse(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setCoarse(e.matches);
    // addEventListener は Safari 14 未満に無く、そこは addListener のみ対応する。
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, []);

  return coarse;
}
