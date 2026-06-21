# Architecture Decision Records

このディレクトリには、Architecture Decision Record（ADR）を保存します。

## 記録対象

ADR には、ユーザーが明示的に意思決定した内容のみを記録します。

- AI や実装者の推測で意思決定を補完しない
- まだ決定されていない内容は ADR ではなく Issue / Discussion / TODO として扱う
- 後から背景を確認できるように、決定内容・背景・影響を簡潔に残す

## 命名規則

ADR は `NNNN-title.md` の形式で保存します。

例:

- `0001-record-only-explicit-user-decisions.md`

## 一覧

- [0001: ADR にはユーザーが明示的に意思決定した内容のみを記録する](./0001-record-only-explicit-user-decisions.md)
