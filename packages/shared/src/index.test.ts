import { expect, test } from "vitest";
import { APP_NAME } from "./index";

test("APP_NAME はアプリ識別子を返す", () => {
  expect(APP_NAME).toBe("chat-with-nextjs-hono");
});
