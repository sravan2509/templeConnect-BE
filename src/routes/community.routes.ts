import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import * as c from "../controllers/community.controller";

// Devotee-facing temple services, events, follows, community settings and festivals.
const router = Router();

// Public (the signed-in user is detected when a token is sent)
router.get("/temples/:ref", c.templeOverview);
router.get("/services", c.servicesByCategory);
router.get("/services/:id", c.serviceDetail);
router.get("/services/:id/dates", c.serviceDates);
router.get("/services/:id/availability", c.serviceAvailabilityPublic);
router.get("/festivals", c.listFestivals);
router.get("/festivals/:id", c.festivalDetail);
router.get("/places", c.searchPlaces);

// Signed in
router.get("/events", requireAuth, c.eventFeed);
router.get("/events/:id", c.eventDetail);
router.post("/events/:id/respond", requireAuth, c.respondToEvent);
router.delete("/events/:id/respond", requireAuth, c.withdrawEventResponse);
router.get("/follows", requireAuth, c.listFollows);
router.post("/follows", requireAuth, c.followTemple);
router.patch("/follows/:templeRef", requireAuth, c.updateFollow);
router.delete("/follows/:templeRef", requireAuth, c.unfollowTemple);
router.get("/settings", requireAuth, c.getCommunitySettings);
router.put("/settings", requireAuth, c.updateCommunitySettings);

export default router;
