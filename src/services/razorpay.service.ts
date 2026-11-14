import axios from "axios";
import { createHmac, timingSafeEqual } from "crypto";
import { env } from "../config/env";
import { AppError } from "../utils/AppError";

const API = "https://api.razorpay.com/v1";

export function isRazorpayConfigured(): boolean {
  return !!(env.razorpay.keyId && env.razorpay.keySecret);
}

/** Payments run in simulated mode only in development, when Razorpay keys are absent. */
export function paymentMode(): "razorpay" | "simulated" | "unavailable" {
  if (isRazorpayConfigured()) return "razorpay";
  return env.allowSimulatedPayments ? "simulated" : "unavailable";
}

const auth = () => ({ username: env.razorpay.keyId, password: env.razorpay.keySecret });

function gatewayError(err: any, fallback: string): AppError {
  const msg = err?.response?.data?.error?.description;
  console.error(`[RAZORPAY] ${fallback}: ${msg ?? err.message}`);
  return new AppError(msg ? `Payment gateway: ${msg}` : fallback, 502);
}

export const toPaise = (rupees: number) => Math.round(rupees * 100);

export async function createOrder(amountRupees: number, receipt: string, notes: Record<string, string>) {
  try {
    const { data } = await axios.post(
      `${API}/orders`,
      { amount: toPaise(amountRupees), currency: "INR", receipt: receipt.slice(0, 40), notes, payment_capture: 1 },
      { auth: auth(), timeout: 15000 }
    );
    return data as { id: string; amount: number; currency: string; status: string };
  } catch (err) {
    throw gatewayError(err, "Could not start the payment. Please try again.");
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Checkout success callback: signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
  if (!env.razorpay.keySecret) return false;
  const expected = createHmac("sha256", env.razorpay.keySecret).update(`${orderId}|${paymentId}`).digest("hex");
  return safeEqual(expected, signature);
}

export function verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
  if (!env.razorpay.webhookSecret || !signature) return false;
  const expected = createHmac("sha256", env.razorpay.webhookSecret).update(rawBody).digest("hex");
  return safeEqual(expected, signature);
}

export async function fetchPayment(paymentId: string) {
  try {
    const { data } = await axios.get(`${API}/payments/${encodeURIComponent(paymentId)}`, { auth: auth(), timeout: 15000 });
    return data as { id: string; order_id: string; status: string; amount: number; method: string };
  } catch (err) {
    throw gatewayError(err, "Could not verify the payment.");
  }
}

export async function refundPayment(paymentId: string, amountRupees: number, notes: Record<string, string>) {
  try {
    const { data } = await axios.post(
      `${API}/payments/${encodeURIComponent(paymentId)}/refund`,
      { amount: toPaise(amountRupees), speed: "normal", notes },
      { auth: auth(), timeout: 15000 }
    );
    return data as { id: string; status: string; amount: number };
  } catch (err) {
    throw gatewayError(err, "The refund could not be issued.");
  }
}
