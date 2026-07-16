import { Router } from "express";
import { dashboard, dosAndDontsHandler, nearbyAlerts, nearbyEvents } from "../controllers/home.controller";

const router = Router();

router.get("/dashboard", dashboard);
router.get("/dos-and-donts", dosAndDontsHandler);
router.get("/nearby-alerts", nearbyAlerts);
router.get("/nearby-events", nearbyEvents);

export default router;
