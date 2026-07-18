import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import {
  createBirthChart,
  getBirthChart,
  getAstroProfile,
  getForecast,
  getRecommendations,
  completeRecommendation,
} from "../controllers/astrology.controller";

const router = Router();

router.post("/complete-recommendation", completeRecommendation);

router.use(requireAuth);
router.post("/birth-chart", createBirthChart);
router.get("/birth-chart", getBirthChart);
router.get("/astro-profile", getAstroProfile);
router.get("/forecast", getForecast);
router.get("/recommendations", getRecommendations);

export default router;
