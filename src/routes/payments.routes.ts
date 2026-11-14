import { Router } from "express";
import rateLimit from "express-rate-limit";
import { checkoutPage, completeCheckout } from "../controllers/serviceBooking.controller";

// Payment page shown in the app's WebView, authorised by a short-lived signed link.
// (The Razorpay webhook is mounted in app.ts with a raw body parser.)
const router = Router();
router.get("/checkout/:id", checkoutPage);
router.post("/checkout/:id/complete", rateLimit({ windowMs: 10 * 60 * 1000, max: 30 }), completeCheckout);

export default router;
