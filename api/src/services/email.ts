import nodemailer from "nodemailer";
import { createHmac, randomBytes } from "crypto";

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  const host = process.env.SMTP_HOST;
  if (!host) return null;

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host,
      port: parseInt(process.env.SMTP_PORT || "25", 10),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS || "",
          }
        : undefined,
    });
  }
  return transporter;
}

export function hashToken(token: string): string {
  return createHmac("sha256", process.env.JWT_SECRET || "sdm-dev-secret").update(token).digest("hex");
}

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export async function sendPasswordResetEmail(
  to: string,
  token: string,
  appUrl?: string
): Promise<{ success: boolean; devUrl?: string }> {
  const baseUrl = appUrl || process.env.APP_URL || "http://localhost:3000";
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;

  const tp = getTransporter();
  const from = process.env.SMTP_FROM || "noreply@sdm-dashboard.local";

  if (!tp) {
    console.log(`\n[Email] No SMTP configured — would send password reset to: ${to}`);
    console.log(`[Email] Reset link: ${resetUrl}\n`);
    return { success: true, devUrl: resetUrl };
  }

  try {
    await tp.sendMail({
      from,
      to,
      subject: "Reset your SDM Dashboard password",
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 16px;">
          <h2 style="color: #1a1a2e; margin-bottom: 24px;">Reset your password</h2>
          <p style="color: #4a4a6a; line-height: 1.6; margin-bottom: 16px;">
            You requested a password reset for your SDM Dashboard account. Click the button below to set a new password.
          </p>
          <p style="color: #4a4a6a; line-height: 1.6; margin-bottom: 24px;">
            If you didn't request this, you can safely ignore this email — your password won't be changed.
          </p>
          <a href="${resetUrl}"
             style="display: inline-block; background: #4f46e5; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-bottom: 24px;">
            Reset password
          </a>
          <p style="color: #9a9ab0; font-size: 13px; line-height: 1.5;">
            This link expires in 1 hour and can only be used once.<br>
            If the button doesn't work, copy and paste this URL into your browser:<br>
            <a href="${resetUrl}" style="color: #4f46e5; word-break: break-all;">${resetUrl}</a>
          </p>
        </div>
      `,
      text: `Reset your SDM Dashboard password.\n\nClick the link to set a new password: ${resetUrl}\n\nIf you didn't request this, ignore this email. The link expires in 1 hour.`,
    });
    return { success: true };
  } catch (err) {
    console.error("[Email] Failed to send password reset email:", err instanceof Error ? err.message : String(err));
    return { success: false };
  }
}