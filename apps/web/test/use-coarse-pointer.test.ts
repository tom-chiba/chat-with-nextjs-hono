import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useCoarsePointer } from "@/lib/use-coarse-pointer";

type Listener = (e: MediaQueryListEvent) => void;

/**
 * window.matchMedia を制御可能なスタブに差し替える。
 * legacy=true では addEventListener を持たず addListener のみ（古い Safari 相当）。
 * 返り値の spy と dispatch で購読・解除・change 追従を検証できる。
 */
function stubMatchMedia(initialCoarse: boolean, legacy = false) {
  const listeners = new Set<Listener>();
  const addEventListener = vi.fn((_type: string, l: Listener) => {
    listeners.add(l);
  });
  const removeEventListener = vi.fn((_type: string, l: Listener) => {
    listeners.delete(l);
  });
  const addListener = vi.fn((l: Listener) => {
    listeners.add(l);
  });
  const removeListener = vi.fn((l: Listener) => {
    listeners.delete(l);
  });
  const mql = {
    matches: initialCoarse,
    media: "(pointer: coarse)",
    ...(legacy ? { addListener, removeListener } : { addEventListener, removeEventListener }),
  };
  const dispatch = (matches: boolean) => {
    mql.matches = matches;
    for (const l of listeners) l({ matches } as MediaQueryListEvent);
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => mql),
  );
  return { addEventListener, removeEventListener, addListener, removeListener, dispatch };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("matchMedia 非対応環境（jsdom）では false を返す", () => {
  const { result } = renderHook(() => useCoarsePointer());
  expect(result.current).toBe(false);
});

test("coarse ポインタなら true を返す", () => {
  stubMatchMedia(true);
  const { result } = renderHook(() => useCoarsePointer());
  expect(result.current).toBe(true);
});

test("change 発火でポインタ種別の変化に追従する", () => {
  const mql = stubMatchMedia(false);
  const { result } = renderHook(() => useCoarsePointer());
  expect(result.current).toBe(false);

  act(() => mql.dispatch(true));
  expect(result.current).toBe(true);

  act(() => mql.dispatch(false));
  expect(result.current).toBe(false);
});

test("アンマウントで change 購読を解除する", () => {
  const mql = stubMatchMedia(true);
  const { unmount } = renderHook(() => useCoarsePointer());
  unmount();
  expect(mql.removeEventListener).toHaveBeenCalledTimes(1);
});

test("addEventListener 非対応環境では addListener/removeListener を使う", () => {
  const mql = stubMatchMedia(false, true);
  const { result, unmount } = renderHook(() => useCoarsePointer());
  expect(mql.addListener).toHaveBeenCalledTimes(1);

  act(() => mql.dispatch(true));
  expect(result.current).toBe(true);

  unmount();
  expect(mql.removeListener).toHaveBeenCalledTimes(1);
});
