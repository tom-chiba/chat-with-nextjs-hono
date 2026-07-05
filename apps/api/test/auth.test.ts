import { afterEach, describe, expect, test, vi } from "vitest";
import {
  resolveWebAuthnRp,
  sendChangeEmailConfirmationWithResend,
  sendPasswordResetEmailWithResend,
  sendVerificationEmailWithResend,
} from "../src/auth";

const baseEmail = {
  from: "test@example.com",
  to: "user@example.net",
  url: "https://api.example.com/verify-email?token=token",
};

describe("resolveWebAuthnRp", () => {
  test("本番 URL からホスト名を RP ID に、origin をそのまま導出する", () => {
    expect(resolveWebAuthnRp("https://chat.tom-chiba.com")).toEqual({
      rpID: "chat.tom-chiba.com",
      origin: "https://chat.tom-chiba.com",
    });
  });

  test("ローカル URL（http・ポート付き）でも正しく導出する", () => {
    expect(resolveWebAuthnRp("http://localhost:3000")).toEqual({
      rpID: "localhost",
      origin: "http://localhost:3000",
    });
  });

  test("末尾スラッシュは origin から除去する（rpID には影響しない）", () => {
    expect(resolveWebAuthnRp("https://chat.tom-chiba.com/")).toEqual({
      rpID: "chat.tom-chiba.com",
      origin: "https://chat.tom-chiba.com",
    });
  });
});

describe("sendVerificationEmailWithResend", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("Resend に検証メールを送信する", async () => {
    const send = vi.fn().mockResolvedValue({
      data: { id: "email-id" },
      error: null,
      headers: null,
    });

    await sendVerificationEmailWithResend({
      emailSender: { send },
      ...baseEmail,
    });

    expect(send).toHaveBeenCalledWith({
      from: baseEmail.from,
      to: baseEmail.to,
      subject: "メールアドレスの確認",
      text: `以下のリンクからメールアドレスを確認してください:\n${baseEmail.url}`,
    });
  });

  test("宛先が suppression 対象の Resend API エラーは認証フローへ throw しない", async () => {
    const error = {
      name: "validation_error",
      message: "Email user@example.net is suppressed",
      statusCode: 422,
    };
    const send = vi.fn().mockResolvedValue({
      data: null,
      error,
      headers: null,
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      sendVerificationEmailWithResend({
        emailSender: { send },
        ...baseEmail,
      }),
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith("Verification email delivery failed", {
      recipientDomain: "example.net",
      error: {
        ...error,
        message: "Email [email] is suppressed",
      },
    });
  });

  test("suppression 以外の Resend API エラーは認証フローへ throw する", async () => {
    const error = {
      name: "invalid_api_key",
      message: "Invalid API key",
      statusCode: 401,
    };
    const send = vi.fn().mockResolvedValue({
      data: null,
      error,
      headers: null,
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      sendVerificationEmailWithResend({
        emailSender: { send },
        ...baseEmail,
      }),
    ).rejects.toThrow("Verification email delivery failed");

    expect(consoleError).toHaveBeenCalledWith("Verification email delivery failed", {
      recipientDomain: "example.net",
      error,
    });
  });

  test("Resend クライアントの例外は認証フローへ throw する", async () => {
    const send = vi.fn().mockRejectedValue(new Error("network failed"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      sendVerificationEmailWithResend({
        emailSender: { send },
        ...baseEmail,
      }),
    ).rejects.toThrow("Verification email delivery failed");

    expect(consoleError).toHaveBeenCalledWith("Verification email delivery failed", {
      recipientDomain: "example.net",
      error: { message: "network failed", name: "Error" },
    });
  });
});

describe("sendPasswordResetEmailWithResend", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("Resend にパスワード再設定メールを送信する", async () => {
    const send = vi.fn().mockResolvedValue({
      data: { id: "email-id" },
      error: null,
      headers: null,
    });

    await sendPasswordResetEmailWithResend({
      emailSender: { send },
      ...baseEmail,
    });

    expect(send).toHaveBeenCalledWith({
      from: baseEmail.from,
      to: baseEmail.to,
      subject: "パスワードの再設定",
      text: expect.stringContaining(baseEmail.url),
    });
  });

  test("Resend API エラーは認証フローへ throw する", async () => {
    const send = vi.fn().mockResolvedValue({
      data: null,
      error: {
        name: "invalid_api_key",
        message: "Invalid API key",
        statusCode: 401,
      },
      headers: null,
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      sendPasswordResetEmailWithResend({
        emailSender: { send },
        ...baseEmail,
      }),
    ).rejects.toThrow("Password reset email delivery failed");

    expect(consoleError).toHaveBeenCalledWith(
      "Password reset email delivery failed",
      expect.any(Object),
    );
  });
});

describe("sendChangeEmailConfirmationWithResend", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("Resend にメール変更の承認メールを現アドレスへ送信し、本文に新アドレスを含める", async () => {
    const send = vi.fn().mockResolvedValue({
      data: { id: "email-id" },
      error: null,
      headers: null,
    });

    await sendChangeEmailConfirmationWithResend({
      emailSender: { send },
      from: baseEmail.from,
      to: baseEmail.to,
      newEmail: "new@example.org",
      url: baseEmail.url,
    });

    expect(send).toHaveBeenCalledWith({
      from: baseEmail.from,
      to: baseEmail.to,
      subject: "メールアドレス変更の確認",
      text: expect.stringContaining("new@example.org"),
    });
    expect(send.mock.calls[0]?.[0]?.text).toContain(baseEmail.url);
  });

  test("Resend API エラーは認証フローへ throw する", async () => {
    const send = vi.fn().mockResolvedValue({
      data: null,
      error: {
        name: "invalid_api_key",
        message: "Invalid API key",
        statusCode: 401,
      },
      headers: null,
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      sendChangeEmailConfirmationWithResend({
        emailSender: { send },
        from: baseEmail.from,
        to: baseEmail.to,
        newEmail: "new@example.org",
        url: baseEmail.url,
      }),
    ).rejects.toThrow("Change email confirmation email delivery failed");

    expect(consoleError).toHaveBeenCalledWith(
      "Change email confirmation email delivery failed",
      expect.any(Object),
    );
  });
});
