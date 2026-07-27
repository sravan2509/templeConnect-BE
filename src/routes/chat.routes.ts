import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { getMessages, sendMessage, submitReview, getChatUsers } from "../controllers/chat.controller";

const router = Router();
router.use(requireAuth);

router.get("/chat/:userId", getMessages);
router.post("/chat/:userId", sendMessage);
router.get("/chat-users", getChatUsers);
router.post("/priests/:id/reviews", submitReview);

export default router;
