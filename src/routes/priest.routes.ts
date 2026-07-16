import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { getPriest, getPriestAvailability, getPriestReviews, getPriestServices, listPriests } from "../controllers/booking.controller";

const router = Router();

router.use(requireAuth);
router.get("/", listPriests);
router.get("/:id", getPriest);
router.get("/:id/reviews", getPriestReviews);
router.get("/:id/services", getPriestServices);
router.get("/:id/availability", getPriestAvailability);

export default router;
