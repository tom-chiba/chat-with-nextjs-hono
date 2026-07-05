import { expect, test } from "vitest";
import { APP_NAME, parseMentionCandidates, tokenizeMessageBody } from "./index";

test("APP_NAME はアプリ識別子を返す", () => {
  expect(APP_NAME).toBe("chat");
});

test("parseMentionCandidates は本文中の @<name> を順に拾う", () => {
  expect(parseMentionCandidates("hello @alice and @bob.")).toEqual(["alice", "bob"]);
});

test("parseMentionCandidates は日本語名と全角句点を扱える", () => {
  expect(parseMentionCandidates("@千葉さん、おはよう。")).toEqual(["千葉さん"]);
});

test("parseMentionCandidates はメールアドレスを誤検出しない", () => {
  expect(parseMentionCandidates("メールは a@example.com です")).toEqual([]);
});

test("parseMentionCandidates はメンション無しなら空配列", () => {
  expect(parseMentionCandidates("ふつうの本文")).toEqual([]);
});

test("tokenizeMessageBody はリンクをリンクトークンに分割する", () => {
  expect(tokenizeMessageBody("詳細は https://example.com を参照")).toEqual([
    { type: "text", value: "詳細は " },
    { type: "link", value: "https://example.com" },
    { type: "text", value: " を参照" },
  ]);
});

test("tokenizeMessageBody はリンク末尾の句読点を剥がす", () => {
  expect(tokenizeMessageBody("https://example.com。")).toEqual([
    { type: "link", value: "https://example.com" },
    { type: "text", value: "。" },
  ]);
});

test("tokenizeMessageBody はメンションとリンクを同時に拾う", () => {
  expect(tokenizeMessageBody("@alice https://example.com 見て")).toEqual([
    { type: "mention", value: "@alice" },
    { type: "text", value: " " },
    { type: "link", value: "https://example.com" },
    { type: "text", value: " 見て" },
  ]);
});
