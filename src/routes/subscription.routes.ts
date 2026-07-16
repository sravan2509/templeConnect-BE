import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { cancelSubscription, getPlan, updatePaymentMethod, upgradePlan } from "../controllers/profile.controller";

const router = Router();

router.use(requireAuth);
router.get("/plan", getPlan);
router.post("/upgrade", upgradePlan);
router.patch("/payment-method", updatePaymentMethod);
router.post("/cancel", cancelSubscription);

export default router;
