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
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

export const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));

app.get("/health", (_req, res) => res.json({ status: "ok" }));

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

app.use(notFoundHandler);
app.use(errorHandler);
