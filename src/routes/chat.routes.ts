import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { getMessages, sendMessage, markMessagesRead, getChatUsers } from "../controllers/chat.controller";

// Mounted at /api/chat. Auth is applied per router mount, so unrelated /api paths still 404.
const router = Router();
router.use(requireAuth);

router.get("/users", getChatUsers);
router.get("/:userId", getMessages);
router.post("/:userId", sendMessage);
router.patch("/:userId/read", markMessagesRead);

export default router;
