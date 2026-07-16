import { Router } from "express";
import { cultural, etiquette, kids, search } from "../controllers/knowledgeBase.controller";

const router = Router();

router.get("/", search);
router.get("/cultural", cultural);
router.get("/kids", kids);
router.get("/etiquette", etiquette);

export default router;
