import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { createBookingHandler, getBooking, listBookings, rescheduleBooking, cancelBooking, payForBooking } from "../controllers/booking.controller";

const router = Router();
router.use(requireAuth);

router.get("/", listBookings);
router.post("/", createBookingHandler);
router.get("/:id", getBooking);
router.patch("/:id/reschedule", rescheduleBooking);
router.delete("/:id", cancelBooking);
router.post("/:id/pay", payForBooking);

export default router;
