import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { createSupportTicket, getFaqs, getSupportTickets } from "../controllers/support.controller";

const router = Router();

router.get("/faqs", getFaqs);
router.post("/tickets", requireAuth, createSupportTicket);
router.get("/tickets", requireAuth, getSupportTickets);

export default router;
