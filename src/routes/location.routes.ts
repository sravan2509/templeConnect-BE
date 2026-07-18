import { Router } from "express";
import {
  findTemples,
  geocode,
  getStates,
  getDistrictsHandler,
  getMandalsHandler,
} from "../controllers/location.controller";

const router = Router();

router.get("/geocode", geocode);
router.get("/temples", findTemples);
router.get("/states", getStates);
router.get("/districts", getDistrictsHandler);
router.get("/mandals", getMandalsHandler);

export default router;
