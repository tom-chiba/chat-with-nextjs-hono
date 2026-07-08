import { expect, test } from "vitest";
import { shouldSubmitOnEnter } from "@/lib/use-coarse-pointer";

/** テストに必要な最小限のフィールドだけを持つ keydown イベントを作る。 */
function keyEvent(opts: {
  key?: string;
  shiftKey?: boolean;
  isComposing?: boolean;
}): React.KeyboardEvent<HTMLTextAreaElement> {
  return {
    key: opts.key ?? "Enter",
    shiftKey: opts.shiftKey ?? false,
    nativeEvent: { isComposing: opts.isComposing ?? false },
  } as React.KeyboardEvent<HTMLTextAreaElement>;
}

test("PC で素の Enter は送信する", () => {
  expect(shouldSubmitOnEnter(keyEvent({ key: "Enter" }), false)).toBe(true);
});

test("タッチ端末（coarse）では Enter でも送信しない", () => {
  expect(shouldSubmitOnEnter(keyEvent({ key: "Enter" }), true)).toBe(false);
});

test("Shift+Enter は改行として送信しない", () => {
  expect(shouldSubmitOnEnter(keyEvent({ key: "Enter", shiftKey: true }), false)).toBe(false);
});

test("IME 変換確定中の Enter は送信しない", () => {
  expect(shouldSubmitOnEnter(keyEvent({ key: "Enter", isComposing: true }), false)).toBe(false);
});

test("Enter 以外のキーでは送信しない", () => {
  expect(shouldSubmitOnEnter(keyEvent({ key: "a" }), false)).toBe(false);
});
