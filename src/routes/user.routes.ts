import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import {
  changePassword,
  createCheckin,
  deleteAccount,
  enable2fa,
  get2fa,
  getCheckins,
  getDevices,
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

router.patch("/me/password", changePassword);
router.get("/me/2fa", get2fa);
router.post("/me/2fa", enable2fa);
router.get("/me/devices", getDevices);

router.get("/me/bookings-history", getBookingsHistory);
router.get("/me/checkins", getCheckins);
router.post("/me/checkins", createCheckin);
router.get("/me/donations", getDonations);

router.get("/me/bookmarks", getBookmarks);
router.post("/me/bookmarks", createBookmark);
router.delete("/me/bookmarks/:id", deleteBookmark);

export default router;
