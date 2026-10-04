import { Router } from "express";
import { dashboard, dosAndDontsHandler } from "../controllers/home.controller";
import { nearbyTempleEvents } from "../controllers/temple.controller";

const router = Router();

router.get("/dashboard", dashboard);
router.get("/dos-and-donts", dosAndDontsHandler);
// Upcoming events at temples near ?lat=&lng= (replaces the old "coming soon" stubs).
router.get("/nearby-events", nearbyTempleEvents);
router.get("/nearby-alerts", nearbyTempleEvents);

export default router;
