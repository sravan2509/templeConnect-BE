import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../middleware/auth";
import * as b from "../controllers/serviceBooking.controller";

const createLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many booking attempts. Please wait a few minutes." },
});

// Seva / Pooja bookings made by devotees.
const router = Router();
router.use(requireAuth);
router.get("/", b.myBookings);
router.post("/", createLimiter, b.createBooking);
router.get("/:id", b.getMyBooking);
router.post("/:id/cancel", b.cancelMyBooking);
router.post("/:id/reschedule", b.rescheduleMyBooking);
router.post("/:id/pay", b.retryPayment);

export default router;
