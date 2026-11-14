import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../middleware/auth";
import { requireTempleOnly, requireTempleScope } from "../middleware/templeScope";
import { MAX_IMAGE_BYTES } from "../services/storage.service";
import * as portal from "../controllers/templePortal.controller";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } });

// Temple admin portal. Temple admins are scoped to their temple; the main admin passes ?templeId= or ?festivalId=.
const router = Router();
router.use(requireAuth, requireTempleScope);

router.get("/me", portal.portalMe);
router.get("/dashboard", portal.portalDashboard);
router.patch("/temple", requireTempleOnly, portal.updateTempleProfile);
router.put("/policy", requireTempleOnly, portal.updatePolicy);
router.post("/upload", upload.single("image"), portal.uploadImage);

router.get("/services", portal.listServices);
router.post("/services", portal.createService);
router.patch("/services/:id", portal.updateService);
router.delete("/services/:id", portal.deleteService);
router.get("/services/:id/availability", portal.serviceAvailability);

router.get("/events", requireTempleOnly, portal.listEvents);
router.post("/events", requireTempleOnly, portal.createEvent);
router.patch("/events/:id", requireTempleOnly, portal.updateEvent);
router.delete("/events/:id", requireTempleOnly, portal.cancelEvent);
router.get("/events/:id/responses", requireTempleOnly, portal.eventResponses);

router.get("/bookings", portal.listBookings);
router.post("/bookings", portal.createWalkIn);
router.get("/bookings/:id", portal.getBooking);
router.post("/bookings/:id/mark-paid", portal.markPaid);
router.post("/bookings/:id/settle-refund", portal.settleRefund);
router.post("/bookings/:id/complete", portal.setBookingStatus("completed"));
router.post("/bookings/:id/no-show", portal.setBookingStatus("no_show"));
router.post("/bookings/:id/cancel", portal.staffCancel);
router.post("/bookings/:id/reschedule", portal.staffReschedule);

router.get("/transactions", portal.listTransactions);

router.get("/notifications/audience", requireTempleOnly, portal.previewAudience);
router.post("/notifications", requireTempleOnly, portal.sendAnnouncement);
router.get("/notifications", requireTempleOnly, portal.notificationHistory);

router.get("/audit", portal.auditHistory);

export default router;
