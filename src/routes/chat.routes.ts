import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { getMessages, sendMessage, markMessagesRead, submitReview, getChatUsers } from "../controllers/chat.controller";

const router = Router();
router.use(requireAuth);

router.get("/chat/:userId", getMessages);
router.post("/chat/:userId", sendMessage);
router.patch("/chat/:userId/read", markMessagesRead);
router.get("/chat-users", getChatUsers);
router.post("/priests/:id/reviews", submitReview);

export default router;
