import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";

import authRoutes from "./routes/auth.routes";
import locationRoutes from "./routes/location.routes";
import astrologyRoutes from "./routes/astrology.routes";
import homeRoutes from "./routes/home.routes";
import templeRoutes from "./routes/temple.routes";
import knowledgeBaseRoutes from "./routes/knowledgeBase.routes";
import priestRoutes from "./routes/priest.routes";
import bookingRoutes from "./routes/booking.routes";
import userRoutes from "./routes/user.routes";
import supportRoutes from "./routes/support.routes";
import subscriptionRoutes from "./routes/subscription.routes";
import donationRoutes from "./routes/donation.routes";
import adminRoutes from "./routes/admin.routes";
import chatRoutes from "./routes/chat.routes";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

export const app = express();

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors());
app.use(express.json());

morgan.token("body", (req: any) => {
  if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
    const safe = { ...req.body };
    if (safe.password) safe.password = "***";
    if (safe.passwordHash) safe.passwordHash = "***";
    return JSON.stringify(safe);
  }
  return "";
});
app.use(morgan(":method :url :status :response-time ms :body"));

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.get("/health", (_req, res) => res.json({ status: "ok", version: "2.0" }));

app.get("/api/health", (_req, res) => res.json({ status: "ok", version: "2.0" }));

app.use("/api/auth", authRoutes);
app.use("/api/locations", locationRoutes);
app.use("/api/astrology", astrologyRoutes);
app.use("/api/home", homeRoutes);
app.use("/api/temples", templeRoutes);
app.use("/api/knowledge-base", knowledgeBaseRoutes);
app.use("/api/priests", priestRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/users", userRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use("/api/donations", donationRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", chatRoutes);
app.use(notFoundHandler);
app.use(errorHandler);
