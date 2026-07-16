import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { createSupportTicket, getFaqs } from "../controllers/profile.controller";

const router = Router();

router.get("/faqs", getFaqs);
router.post("/tickets", requireAuth, createSupportTicket);

export default router;
