import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { createBirthChart, getBirthChart, getForecast, getRecommendations } from "../controllers/astrology.controller";

const router = Router();

router.use(requireAuth);
router.post("/birth-chart", createBirthChart);
router.get("/birth-chart", getBirthChart);
router.get("/forecast", getForecast);
router.get("/recommendations", getRecommendations);

export default router;
