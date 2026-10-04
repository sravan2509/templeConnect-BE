import { Router } from "express";
import rateLimit from "express-rate-limit";
import { login, register, forgotPassword, resetPassword, changePassword } from "../controllers/auth.controller";
import { requireAuth } from "../middleware/auth";

const router = Router();

// AUTH_RATE_LIMIT_MAX can raise the per-IP limits (e.g. for automated test runs); defaults are production values.
const override = Number(process.env.AUTH_RATE_LIMIT_MAX || 0);

const limiter = (max: number, windowMinutes: number) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max: override > 0 ? override : max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many attempts. Please wait a few minutes and try again." },
  });

router.post("/register", limiter(10, 60), register);
router.post("/login", limiter(10, 15), login);
router.post("/forgot-password", limiter(5, 60), forgotPassword);
router.post("/reset-password", limiter(10, 15), resetPassword);
router.post("/change-password", requireAuth, limiter(10, 15), changePassword);

export default router;
