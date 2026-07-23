import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireAdmin, requirePriest } from "../middleware/roleAuth";
import {
  adminDashboard, createPriest, updatePriest, deletePriest,
  listPujas, createPuja, updatePuja, deletePuja,
  getPriestProfile, updatePriestProfile,
  getPriestStats, acceptBooking, rejectBooking, registerPushToken,
} from "../controllers/admin.controller";
import {
  getNotifications, markRead, markAllRead, getUnreadCount,
  getDailySuggestion, autocompletePlaces, getMapTemples, sendDailySuggestionPush,
} from "../controllers/app.controller";
import {
  listKbArticles, createKbArticle, updateKbArticle, deleteKbArticle
} from "../controllers/knowledgeBaseAdmin.controller";

const router = Router();
router.use(requireAuth);

// Admin dashboard
router.get("/dashboard", requireAdmin, adminDashboard);

// Knowledge Base management (admin)
router.get("/kb", requireAdmin, listKbArticles);
router.post("/kb", requireAdmin, createKbArticle);
router.patch("/kb/:id", requireAdmin, updateKbArticle);
router.delete("/kb/:id", requireAdmin, deleteKbArticle);

// Puja management (admin)
router.get("/pujas", listPujas);
router.post("/pujas", requireAdmin, createPuja);
router.patch("/pujas/:id", requireAdmin, updatePuja);
router.delete("/pujas/:id", requireAdmin, deletePuja);

// Priest management (admin)
router.post("/priests", requireAdmin, createPriest);
router.patch("/priests/:id", requireAdmin, updatePriest);
router.delete("/priests/:id", requireAdmin, deletePriest);

// Priest self-service
router.get("/priest/profile", requirePriest, getPriestProfile);
router.patch("/priest/profile", requirePriest, updatePriestProfile);
router.get("/priest/stats", requirePriest, getPriestStats);

// Booking management (priest)
router.post("/bookings/:id/accept", requirePriest, acceptBooking);
router.post("/bookings/:id/reject", requirePriest, rejectBooking);

// Notifications
router.get("/notifications", getNotifications);
router.patch("/notifications/:id/read", markRead);
router.post("/notifications/read-all", markAllRead);
router.get("/notifications/unread-count", getUnreadCount);

// App features
router.get("/daily-suggestion", getDailySuggestion);
router.post("/daily-suggestion-push", requireAdmin, sendDailySuggestionPush);
router.get("/autocomplete", autocompletePlaces);
router.get("/map-temples", getMapTemples);

// Push token
router.post("/push-token", registerPushToken);

export default router;
