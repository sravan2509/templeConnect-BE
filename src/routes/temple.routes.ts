import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import {
  getTempleDetail,
  getTempleEvents,
  getTempleHistory,
  getTempleTimings,
  mapView,
  removeReminder,
  setReminder,
} from "../controllers/temple.controller";

const router = Router();

router.get("/map", mapView);
router.get("/:placeId", getTempleDetail);
router.get("/:placeId/timings", getTempleTimings);
router.get("/:placeId/events", getTempleEvents);
router.get("/:placeId/history", getTempleHistory);
router.post("/:placeId/reminders", requireAuth, setReminder);
router.delete("/:placeId/reminders/:id", requireAuth, removeReminder);

export default router;
