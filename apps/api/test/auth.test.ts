import { afterEach, describe, expect, test, vi } from "vitest";
import { sendVerificationEmailWithResend } from "../src/auth";

const baseEmail = {
  from: "test@example.com",
  to: "user@example.net",
  url: "https://api.example.com/verify-email?token=token",
};

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

  test("Resend の API エラーを認証フローへ throw しない", async () => {
    const error = {
      name: "validation_error",
      message: "Email is suppressed",
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

    expect(consoleError).toHaveBeenCalledWith(
      "Verification email delivery failed",
      {
        recipientDomain: "example.net",
        error,
      },
    );
  });

  test("Resend クライアントの例外を認証フローへ throw しない", async () => {
    const send = vi.fn().mockRejectedValue(new Error("network failed"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      sendVerificationEmailWithResend({
        emailSender: { send },
        ...baseEmail,
      }),
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith(
      "Verification email delivery failed",
      {
        recipientDomain: "example.net",
        error: { message: "network failed", name: "Error" },
      },
    );
  });
});
