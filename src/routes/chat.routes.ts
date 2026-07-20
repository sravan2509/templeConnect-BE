import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { getMessages, submitReview, getChatUsers } from "../controllers/chat.controller";

const router = Router();
router.use(requireAuth);

router.get("/chat/:userId", getMessages);
router.get("/chat-users", getChatUsers);
router.post("/priests/:id/reviews", submitReview);

export default router;
