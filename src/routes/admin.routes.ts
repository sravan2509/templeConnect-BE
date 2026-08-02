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
  listSuggestions, createSuggestion, updateSuggestion, deleteSuggestion,
} from "../controllers/app.controller";
import { createFaq, updateFaq, deleteFaq } from "../controllers/support.controller";
import { listKbArticles, createKbArticle, updateKbArticle, deleteKbArticle } from "../controllers/knowledgeBaseAdmin.controller";

const router = Router();
router.use(requireAuth);

router.get("/dashboard", requireAdmin, adminDashboard);

// KB
router.get("/kb", requireAdmin, listKbArticles);
router.post("/kb", requireAdmin, createKbArticle);
router.patch("/kb/:id", requireAdmin, updateKbArticle);
router.delete("/kb/:id", requireAdmin, deleteKbArticle);

// Pujas
router.get("/pujas", listPujas);
router.post("/pujas", requireAdmin, createPuja);
router.patch("/pujas/:id", requireAdmin, updatePuja);
router.delete("/pujas/:id", requireAdmin, deletePuja);

// Priests
router.post("/priests", requireAdmin, createPriest);
router.patch("/priests/:id", requireAdmin, updatePriest);
router.delete("/priests/:id", requireAdmin, deletePriest);

// Priest self
router.get("/priest/profile", requirePriest, getPriestProfile);
router.patch("/priest/profile", requirePriest, updatePriestProfile);
router.get("/priest/stats", requirePriest, getPriestStats);

// Bookings
router.post("/bookings/:id/accept", requirePriest, acceptBooking);
router.post("/bookings/:id/reject", requirePriest, rejectBooking);

// Notifications
router.get("/notifications", getNotifications);
router.patch("/notifications/:id/read", markRead);
router.post("/notifications/read-all", markAllRead);
router.get("/notifications/unread-count", getUnreadCount);

// Daily suggestions
router.get("/suggestions", requireAdmin, listSuggestions);
router.post("/suggestions", requireAdmin, createSuggestion);
router.patch("/suggestions/:id", requireAdmin, updateSuggestion);
router.delete("/suggestions/:id", requireAdmin, deleteSuggestion);
router.get("/daily-suggestion", getDailySuggestion);
router.post("/daily-suggestion-push", requireAdmin, sendDailySuggestionPush);

// FAQs
router.post("/faqs", requireAdmin, createFaq);
router.patch("/faqs/:id", requireAdmin, updateFaq);
router.delete("/faqs/:id", requireAdmin, deleteFaq);

// App
router.get("/autocomplete", autocompletePlaces);
router.get("/map-temples", getMapTemples);

router.post("/push-token", registerPushToken);

export default router;
