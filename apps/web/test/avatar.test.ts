import { expect, test } from "vitest";
import { initialOf } from "@/lib/avatar";

test("通常の名前は先頭 1 文字を返す", () => {
  expect(initialOf("アオイ")).toBe("ア");
});

test("サロゲートペア（絵文字始まり）を割らずに 1 文字返す", () => {
  expect(initialOf("😀太郎")).toBe("😀");
});

test("複数コードポイントの書記素クラスタ（国旗など）はコードポイント境界で割れる", () => {
  // Array.from はコードポイント単位で分割するため書記素クラスタは保持されない。
  // 🇯🇵 は 2 つの地域指標記号（各サロゲートペア）から成り、先頭の 🇯 だけが返る。
  expect(initialOf("🇯🇵さん")).toBe("🇯");
});

test("空文字ではフォールバックの ? を返す", () => {
  expect(initialOf("")).toBe("?");
});
