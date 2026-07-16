import { Router } from "express";
import { findTemples, geocode } from "../controllers/location.controller";

const router = Router();

router.get("/geocode", geocode);
router.get("/temples", findTemples);

export default router;
