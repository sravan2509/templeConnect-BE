import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { createDonation, getDonations } from "../controllers/profile.controller";

const router = Router();

router.get("/", requireAuth, getDonations);
// Returns 501 until a payment gateway is integrated.
router.post("/", requireAuth, createDonation);

export default router;
