import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { getPriestsByPuja } from "../controllers/booking.controller";
import { getPriest, getPriestReviews, listPriests } from "../controllers/booking.controller";

const router = Router();
router.use(requireAuth);

router.get("/", listPriests);
router.get("/by-puja/:pujaId", getPriestsByPuja);
router.get("/:id", getPriest);
router.get("/:id/reviews", getPriestReviews);

export default router;
