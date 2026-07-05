/**
 * 入力長（書記素数）の上限判定と、超過時に表示する UI 注記文言を集約する。
 * 判定式・境界条件・上限定数・文言を 1 箇所にまとめ、フォーム間の齟齬を防ぐ。
 */

import {
  isWithinMessageLength,
  isWithinRoomNameLength,
  MAX_MESSAGE_LENGTH,
  MAX_ROOM_NAME_LENGTH,
} from "@repo/shared";

/**
 * 入力長が上限（書記素数）を超えたときに表示する注記文言。
 * メッセージ送信・編集（chat-room / message-item）とルーム名（room-list）で
 * 同じ文言を使うため、ここで一元管理して定数（MAX_*_LENGTH）との同期漏れを防ぐ。
 */
export const MESSAGE_TOO_LONG_MESSAGE = `メッセージは ${MAX_MESSAGE_LENGTH} 文字以内で入力してください。`;
export const ROOM_NAME_TOO_LONG_MESSAGE = `ルーム名は ${MAX_ROOM_NAME_LENGTH} 文字以内で入力してください。`;

/**
 * 入力が上限（書記素数）を超えているか。
 * 上限比較自体はサーバと共有する述語（isWithin*Length）に委ね、FE 固有の責務である
 * trim（送信時に前後空白を除いた本文で判定）と否定だけをここで担う。これにより
 * ボタン活性・送信ガード・注記表示が、サーバの zod スキーマと同一基準で揃う。
 */
export const isMessageTooLong = (value: string): boolean => !isWithinMessageLength(value.trim());
export const isRoomNameTooLong = (value: string): boolean => !isWithinRoomNameLength(value.trim());
