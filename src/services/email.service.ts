import nodemailer from "nodemailer";
import { env } from "../config/env";

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (!env.smtp.host) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    });
  }
  return transporter;
}

export function isEmailConfigured(): boolean {
  return !!env.smtp.host;
}

/** Sends an email. Without SMTP configured it logs to the console (development only). */
export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const t = getTransporter();
  if (!t) {
    if (env.isProduction) throw new Error("SMTP is not configured");
    console.log(`[EMAIL:dev] To: ${to} | ${subject}\n${text}`);
    return;
  }
  await t.sendMail({ from: env.smtp.from, to, subject, text });
}
