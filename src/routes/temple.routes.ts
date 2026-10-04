import { Router } from "express";
import {
  findTemples,
  findTemplesByDeityHandler,
  findTemplesNearbyHandler,
  getTempleDetail,
  getTempleEvents,
  getTempleHistory,
  getTempleTimings,
  listReminders,
  mapView,
  nearbyTempleEvents,
  removeReminder,
  setReminder,
} from "../controllers/temple.controller";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.get("/search", findTemples);
router.get("/map", mapView);
router.get("/nearby", findTemplesNearbyHandler);
router.get("/nearby-events", nearbyTempleEvents);
router.post("/search-by-deity", findTemplesByDeityHandler);

router.get("/:placeId", getTempleDetail);
router.get("/:placeId/timings", getTempleTimings);
router.get("/:placeId/events", getTempleEvents);
router.get("/:placeId/history", getTempleHistory);
router.get("/:placeId/reminders", requireAuth, listReminders);
router.post("/:placeId/reminders", requireAuth, setReminder);
router.delete("/:placeId/reminders/:id", requireAuth, removeReminder);

export default router;
