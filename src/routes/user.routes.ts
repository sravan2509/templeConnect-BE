import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import {
  createCheckin,
  deleteAccount,
  getCheckins,
  getDonations,
  getMe,
  getNotificationPrefs,
  updateMe,
  updateNotificationPrefs,
  getBookingsHistory,
  getBookmarks,
  createBookmark,
  deleteBookmark,
} from "../controllers/profile.controller";

const router = Router();

router.use(requireAuth);

router.get("/me", getMe);
router.patch("/me", updateMe);
router.delete("/me", deleteAccount);

router.get("/me/notification-preferences", getNotificationPrefs);
router.patch("/me/notification-preferences", updateNotificationPrefs);

router.get("/me/bookings-history", getBookingsHistory);
router.get("/me/checkins", getCheckins);
router.post("/me/checkins", createCheckin);
router.get("/me/donations", getDonations);

router.get("/me/bookmarks", getBookmarks);
router.post("/me/bookmarks", createBookmark);
router.delete("/me/bookmarks/:id", deleteBookmark);

export default router;
