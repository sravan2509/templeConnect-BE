import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { getPriest, getPriestReviews, getPriestsByPuja, listPriests, submitReview } from "../controllers/booking.controller";

const router = Router();
router.use(requireAuth);

router.get("/", listPriests);
router.get("/by-puja/:pujaId", getPriestsByPuja);
router.get("/:id", getPriest);
router.get("/:id/reviews", getPriestReviews);
router.post("/:id/reviews", submitReview);

export default router;
