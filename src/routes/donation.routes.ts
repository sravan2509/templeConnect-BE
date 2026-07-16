import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { createDonation } from "../controllers/profile.controller";

const router = Router();

router.post("/", requireAuth, createDonation);

export default router;
