import { Request, Response } from "express";
import { createHmac, randomBytes } from "crypto";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { AppError } from "../utils/AppError";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { AuthRequest } from "../middleware/auth";
import {
  bookingInclude, cancelServiceBooking, cancellationQuote, createServiceBooking, isValidDate, loadBooking, presentBooking,
  recordPayment, rescheduleServiceBooking,
} from "../services/serviceBooking.service";
import { fetchPayment, paymentMode, verifyPaymentSignature, verifyWebhookSignature } from "../services/razorpay.service";

const CHECKOUT_TOKEN_MINUTES = 20;

// ── Checkout tokens (the payment page opens in a WebView without the app's auth header) ──

function signCheckout(bookingId: string, exp: number) {
  return createHmac("sha256", env.jwtSecret).update(`checkout:${bookingId}:${exp}`).digest("hex");
}

export function checkoutToken(bookingId: string) {
  const exp = Date.now() + CHECKOUT_TOKEN_MINUTES * 60000;
  return `${exp}.${signCheckout(bookingId, exp)}`;
}

function verifyCheckoutToken(bookingId: string, token: string) {
  const [expStr, sig] = String(token ?? "").split(".");
  const exp = Number(expStr);
  if (!exp || !sig || exp < Date.now()) return false;
  return signCheckout(bookingId, exp) === sig;
}

function checkoutUrl(req: Request, bookingId: string) {
  const base = env.publicApiUrl || `${req.protocol}://${req.get("host")}`;
  return `${base}/api/payments/checkout/${bookingId}?t=${encodeURIComponent(checkoutToken(bookingId))}`;
}

// ── Devotee endpoints ─────────────────────────────────────────

const createSchema = z.object({
  serviceId: z.string().min(1).max(64),
  date: z.string().refine(isValidDate, "Choose a valid date"),
  slotTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a time slot"),
  participants: z.number().int().min(1).max(50).default(1),
  participation: z.enum(["online", "offline"]),
  paymentMode: z.enum(["online", "counter"]),
  devoteeName: z.string().trim().min(1, "Enter the devotee's name").max(100),
  phone: z.string().trim().regex(/^[+\d][\d\s-]{6,18}$/, "Enter a valid phone number").optional().or(z.literal("").transform(() => undefined)),
  gotra: z.string().trim().max(100).optional(),
  nakshatra: z.string().trim().max(50).optional(),
  notes: z.string().trim().max(500).optional(),
  amount: z.number().min(0).max(1000000).optional(),
}).strict();

export const createBooking = catchAsync(async (req: AuthRequest, res: Response) => {
  const d = createSchema.parse(req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId! }, select: { email: true } });
  const { booking, payment } = await createServiceBooking({ ...d, email: user.email }, { userId: req.userId, source: "app" });
  res.status(201).json({
    booking: presentBooking((await loadBooking(booking.id)) as any),
    payment: payment ? { ...payment, keyId: payment.mode === "razorpay" ? env.razorpay.keyId : undefined, checkoutUrl: checkoutUrl(req, booking.id) } : null,
  });
});

async function ownBooking(req: AuthRequest) {
  const b = await loadBooking(req.params.id);
  if (b.userId !== req.userId) throw new AppError("Booking not found", 404);
  return b;
}

export const myBookings = catchAsync(async (req: AuthRequest, res: Response) => {
  const view = z.enum(["upcoming", "past", "all"]).default("all").parse(req.query.view);
  const now = new Date();
  const items = await prisma.serviceBooking.findMany({
    where: {
      userId: req.userId!,
      ...(view === "upcoming" ? { status: { in: ["confirmed", "pending_payment"] }, scheduledAt: { gte: now } }
        : view === "past" ? { OR: [{ scheduledAt: { lt: now } }, { status: { in: ["cancelled", "completed", "no_show", "expired"] } }] } : {}),
    },
    include: { ...bookingInclude, temple: true },
    orderBy: { scheduledAt: view === "upcoming" ? "asc" : "desc" },
    take: 100,
  });
  res.json(items.map((b) => presentBooking(b as any)));
});

export const getMyBooking = catchAsync(async (req: AuthRequest, res: Response) => {
  const b = await ownBooking(req);
  res.json({ ...presentBooking(b as any), cancelQuote: cancellationQuote(b, "user") });
});

export const cancelMyBooking = catchAsync(async (req: AuthRequest, res: Response) => {
  await ownBooking(req);
  const { reason } = z.object({ reason: z.string().trim().max(300).optional() }).strict().parse(req.body ?? {});
  await cancelServiceBooking(req.params.id, { by: "user", actorId: req.userId!, reason });
  res.json(presentBooking((await loadBooking(req.params.id)) as any));
});

export const rescheduleMyBooking = catchAsync(async (req: AuthRequest, res: Response) => {
  await ownBooking(req);
  const { date, slotTime } = z.object({
    date: z.string().refine(isValidDate, "Choose a valid date"),
    slotTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a time slot"),
  }).strict().parse(req.body);
  await rescheduleServiceBooking(req.params.id, { by: "user", date, slotTime });
  res.json(presentBooking((await loadBooking(req.params.id)) as any));
});

/** Restarts payment for an unpaid online booking (e.g. the devotee closed the payment page). */
export const retryPayment = catchAsync(async (req: AuthRequest, res: Response) => {
  const b = await ownBooking(req);
  if (b.status !== "pending_payment") throw new AppError(b.status === "expired" ? "The payment window has expired. Please book again." : "No online payment is due for this booking");
  const mode = paymentMode();
  if (mode === "unavailable") throw new AppError("Online payment is not available right now", 503);
  res.json({ mode, amount: b.amount, orderId: b.razorpayOrderId, keyId: mode === "razorpay" ? env.razorpay.keyId : undefined, checkoutUrl: checkoutUrl(req, b.id) });
});

// ── Payment page (WebView) ────────────────────────────────────

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export const checkoutPage = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id;
  const token = String(req.query.t ?? "");
  const nonce = randomBytes(16).toString("base64");
  res.setHeader("Content-Security-Policy",
    `default-src 'self'; script-src 'nonce-${nonce}' https://checkout.razorpay.com; frame-src https://*.razorpay.com; ` +
    `connect-src 'self' https://*.razorpay.com; img-src * data:; style-src 'unsafe-inline'`);
  res.setHeader("Cache-Control", "no-store");

  const page = (body: string, script = "") => res.type("html").send(`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Temple Connect Payment</title>
<style>body{font-family:system-ui,-apple-system,Roboto,sans-serif;background:#FBF3EA;color:#2B1A10;margin:0;padding:24px;text-align:center}
.card{background:#fff;border-radius:16px;padding:24px;max-width:420px;margin:40px auto;box-shadow:0 2px 10px rgba(0,0,0,.06)}
h1{font-size:20px;margin:0 0 8px}.amt{font-size:34px;font-weight:800;color:#B9673A;margin:16px 0}.muted{color:#7A6658;font-size:14px}
button{width:100%;border:0;border-radius:12px;padding:15px;font-size:16px;font-weight:700;margin-top:12px}
.pay{background:#B9673A;color:#fff}.cancel{background:#F3E4D6;color:#7A4A2A}.badge{display:inline-block;background:#FFF4D6;color:#8A6200;border-radius:8px;padding:4px 10px;font-size:12px;font-weight:700}</style>
</head><body>${body}${script ? `<script nonce="${nonce}">${script}</script>` : ""}</body></html>`);

  if (!verifyCheckoutToken(id, token)) return page(`<div class="card"><h1>Link expired</h1><p class="muted">Please go back and try the payment again.</p></div>`,
    `setTimeout(function(){location.href="tcpay://result?status=failed&reason=expired"},1500)`);
  const b = await prisma.serviceBooking.findUnique({ where: { id }, include: { service: { select: { name: true } }, temple: { select: { name: true } }, festival: { select: { name: true } }, user: { select: { email: true } } } });
  if (!b) return page(`<div class="card"><h1>Booking not found</h1></div>`);
  if (b.paymentStatus === "paid") return page(`<div class="card"><h1>Already paid ✓</h1></div>`, `location.href="tcpay://result?status=success&ref=${esc(b.reference)}"`);
  if (b.status !== "pending_payment") return page(`<div class="card"><h1>Payment window closed</h1><p class="muted">This booking is ${esc(b.status.replace("_", " "))}.</p></div>`,
    `setTimeout(function(){location.href="tcpay://result?status=failed&reason=${esc(b.status)}"},1500)`);

  const place = b.temple?.name ?? b.festival?.name ?? "Temple";
  const summary = `<h1>${esc(b.service.name)}</h1><div class="muted">${esc(place)} · Ref ${esc(b.reference)}</div><div class="amt">₹${b.amount.toLocaleString("en-IN")}</div>`;
  const completeJs = `function complete(payload){fetch(location.pathname+"/complete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.assign({t:${JSON.stringify(token)}},payload))})
.then(function(r){return r.json().then(function(j){if(r.ok){location.href="tcpay://result?status=success&ref=${esc(b.reference)}"}else{location.href="tcpay://result?status=failed&reason="+encodeURIComponent(j.error||"verify")}})})
.catch(function(){location.href="tcpay://result?status=failed&reason=network"})}
function cancel(){location.href="tcpay://result?status=cancelled"}`;

  if (paymentMode() === "simulated" || !b.razorpayOrderId) {
    return page(`<div class="card"><span class="badge">TEST MODE · no money is charged</span>${summary}
<button class="pay" id="pay">Pay ₹${b.amount.toLocaleString("en-IN")} (test)</button><button class="cancel" id="cancel">Cancel</button>
<p class="muted">Razorpay keys aren't configured, so this payment is simulated.</p></div>`,
      `${completeJs};document.getElementById("pay").onclick=function(){this.disabled=true;this.textContent="Processing…";complete({simulated:true})};document.getElementById("cancel").onclick=cancel;`);
  }

  const options = {
    key: env.razorpay.keyId, order_id: b.razorpayOrderId, amount: Math.round(b.amount * 100), currency: "INR",
    name: "Temple Connect", description: `${b.service.name} · ${place}`.slice(0, 250),
    prefill: { name: b.devoteeName, email: b.email ?? b.user?.email ?? "", contact: b.phone ?? "" },
    notes: { reference: b.reference }, theme: { color: "#B9673A" },
  };
  return page(`<div class="card">${summary}<button class="pay" id="pay">Pay securely</button><button class="cancel" id="cancel">Cancel</button>
<p class="muted">UPI · Cards · Netbanking · Wallets, secured by Razorpay</p></div>
<script src="https://checkout.razorpay.com/v1/checkout.js" nonce="${nonce}"></script>`,
    `${completeJs};var o=${JSON.stringify(options)};o.handler=function(r){complete({razorpay_order_id:r.razorpay_order_id,razorpay_payment_id:r.razorpay_payment_id,razorpay_signature:r.razorpay_signature})};
o.modal={ondismiss:function(){}};function open(){var rz=new Razorpay(o);rz.on("payment.failed",function(e){});rz.open()}
document.getElementById("pay").onclick=open;document.getElementById("cancel").onclick=cancel;window.addEventListener("load",open);`);
});

export const completeCheckout = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id;
  const body = z.object({
    t: z.string().max(200),
    simulated: z.boolean().optional(),
    razorpay_order_id: z.string().max(100).optional(),
    razorpay_payment_id: z.string().max(100).optional(),
    razorpay_signature: z.string().max(200).optional(),
  }).strict().parse(req.body);
  if (!verifyCheckoutToken(id, body.t)) throw new AppError("This payment link has expired", 401);
  const b = await prisma.serviceBooking.findUnique({ where: { id } });
  if (!b) throw new AppError("Booking not found", 404);
  if (b.paymentStatus === "paid") return res.json({ ok: true, reference: b.reference });

  if (body.simulated) {
    if (paymentMode() !== "simulated") throw new AppError("Simulated payments are disabled", 403);
    await recordPayment(id, { method: "simulated", gatewayRef: `SIM-${b.reference}`, razorpayPaymentId: `SIM-${b.reference}`, note: "Test-mode payment" });
    return res.json({ ok: true, reference: b.reference });
  }

  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = body;
  if (!orderId || !paymentId || !signature) throw new AppError("Payment details are missing");
  if (orderId !== b.razorpayOrderId || !verifyPaymentSignature(orderId, paymentId, signature)) throw new AppError("Payment verification failed", 400);
  await recordPayment(id, { method: "razorpay", gatewayRef: paymentId, razorpayPaymentId: paymentId });
  res.json({ ok: true, reference: b.reference });
});

/**
 * Razorpay webhook: a safety net in case the app closed before the checkout callback ran.
 * Mounted with a raw body parser so the signature can be checked.
 */
export const razorpayWebhook = catchAsync(async (req: Request, res: Response) => {
  const raw = req.body as Buffer;
  if (!Buffer.isBuffer(raw) || !verifyWebhookSignature(raw, String(req.headers["x-razorpay-signature"] ?? ""))) {
    return res.status(400).json({ error: "Invalid signature" });
  }
  const event = JSON.parse(raw.toString("utf8"));
  if (event.event === "payment.captured" || event.event === "order.paid") {
    const p = event.payload?.payment?.entity;
    const booking = p?.order_id ? await prisma.serviceBooking.findUnique({ where: { razorpayOrderId: p.order_id } }) : null;
    if (booking && booking.paymentStatus !== "paid") {
      const verified = await fetchPayment(p.id).catch(() => null);
      if (verified?.status === "captured" && verified.order_id === booking.razorpayOrderId) {
        await recordPayment(booking.id, { method: "razorpay", gatewayRef: p.id, razorpayPaymentId: p.id, note: "Confirmed via webhook" });
      }
    }
  } else if (event.event === "refund.processed") {
    const r = event.payload?.refund?.entity;
    if (r?.id) await prisma.paymentTransaction.updateMany({ where: { gatewayRef: r.id, type: "refund" }, data: { status: "success" } });
  }
  res.json({ ok: true });
});
