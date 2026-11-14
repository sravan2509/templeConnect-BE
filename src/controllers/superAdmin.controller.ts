import { Response } from "express";
import { randomInt } from "crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { AppError } from "../utils/AppError";
import { prisma } from "../config/prisma";
import { AuthRequest } from "../middleware/auth";
import { logAudit } from "../services/audit.service";
import { communityUserIds } from "../services/audience.service";
import { notifyRecipients } from "../services/push.service";
import { sendEmail } from "../services/email.service";
import { isValidDate } from "../services/serviceBooking.service";

const actor = (req: AuthRequest) => ({ userId: req.userId, role: req.userRole });
const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const dateStr = z.string().refine(isValidDate, "Use a valid date (YYYY-MM-DD)");

function tempPassword() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let p = "";
  for (let i = 0; i < 10; i++) p += chars[randomInt(chars.length)];
  return `${p}@${randomInt(10, 99)}`;
}

// ── Temple admin accounts ─────────────────────────────────────

export const listTempleAdmins = catchAsync(async (req: AuthRequest, res: Response) => {
  const templeId = req.query.templeId as string | undefined;
  const staff = await prisma.templeStaff.findMany({
    where: templeId ? { templeId } : {},
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { id: true, name: true, email: true, role: true, createdAt: true } },
      temple: { select: { id: true, name: true, city: true, state: true } },
    },
  });
  res.json(staff);
});

export const createTempleAdmin = catchAsync(async (req: AuthRequest, res: Response) => {
  const d = z.object({
    templeId: z.string().min(1).max(64),
    name: z.string().trim().min(2, "Enter the admin's name").max(100),
    email: z.string().trim().toLowerCase().email("Enter a valid email").max(200),
    password: z.string().min(8, "Password must be at least 8 characters").max(128).optional(),
    title: z.string().trim().max(60).optional(),
  }).strict().parse(req.body);

  const temple = await prisma.temple.findUnique({ where: { id: d.templeId }, select: { id: true, name: true } });
  if (!temple) throw new AppError("Temple not found", 404);

  const existing = await prisma.user.findUnique({ where: { email: d.email }, include: { templeStaff: true } });
  if (existing?.templeStaff) throw new AppError(existing.templeStaff.templeId === temple.id ? "This person is already an admin of this temple" : "This email is already an admin of another temple", 409);
  if (existing && existing.role !== "devotee") throw new AppError(`This email belongs to a ${existing.role} account and can't be made a temple admin`, 409);

  const password = existing ? undefined : d.password ?? tempPassword();
  const user = await prisma.$transaction(async (tx) => {
    const u = existing
      ? await tx.user.update({ where: { id: existing.id }, data: { role: "temple_admin", tokenVersion: { increment: 1 } } })
      : await tx.user.create({ data: { name: d.name, email: d.email, passwordHash: await bcrypt.hash(password!, 10), role: "temple_admin" } });
    await tx.templeStaff.create({ data: { userId: u.id, templeId: temple.id, title: d.title ?? "Temple Admin" } });
    return u;
  });

  void sendEmail(d.email, `You're now an admin of ${temple.name} on Temple Connect`,
    `Namaste ${d.name},\n\nYou can now manage ${temple.name} (Sevas, events and bookings) in the Temple Connect app.\n\n` +
    `Email: ${d.email}\n${password ? `Temporary password: ${password}\nPlease change it after logging in (More → Change Password).` : "Log in with your existing password."}\n\nTemple Connect`)
    .catch((err) => console.error(`[EMAIL] ${err.message}`));

  await logAudit(actor(req), { templeId: temple.id, action: "temple_admin.create", entityType: "user", entityId: user.id, summary: `Made ${d.email} an admin of ${temple.name}` });
  res.status(201).json({ user: { id: user.id, name: user.name, email: user.email, role: user.role }, temple, temporaryPassword: password ?? null, existingAccount: !!existing });
});

export const resetTempleAdminPassword = catchAsync(async (req: AuthRequest, res: Response) => {
  const staff = await prisma.templeStaff.findUnique({ where: { userId: req.params.userId }, include: { user: true, temple: { select: { name: true } } } });
  if (!staff) throw new AppError("Temple admin not found", 404);
  const password = tempPassword();
  await prisma.user.update({ where: { id: staff.userId }, data: { passwordHash: await bcrypt.hash(password, 10), tokenVersion: { increment: 1 } } });
  void sendEmail(staff.user.email, "Your Temple Connect password was reset", `Your temporary password for ${staff.temple.name}: ${password}\nPlease change it after logging in.`)
    .catch((err) => console.error(`[EMAIL] ${err.message}`));
  await logAudit(actor(req), { templeId: staff.templeId, action: "temple_admin.reset_password", entityType: "user", entityId: staff.userId, summary: `Reset password for ${staff.user.email}` });
  res.json({ temporaryPassword: password });
});

export const removeTempleAdmin = catchAsync(async (req: AuthRequest, res: Response) => {
  const staff = await prisma.templeStaff.findUnique({ where: { userId: req.params.userId }, include: { user: true, temple: { select: { name: true } } } });
  if (!staff) throw new AppError("Temple admin not found", 404);
  // The account stays (with its bookings) as a regular devotee; existing sessions are signed out.
  await prisma.$transaction([
    prisma.templeStaff.delete({ where: { userId: staff.userId } }),
    prisma.user.update({ where: { id: staff.userId }, data: { role: "devotee", tokenVersion: { increment: 1 } } }),
  ]);
  await logAudit(actor(req), { templeId: staff.templeId, action: "temple_admin.remove", entityType: "user", entityId: staff.userId, summary: `Removed ${staff.user.email} as admin of ${staff.temple.name}` });
  res.status(204).send();
});

// ── Festivals & ghats ─────────────────────────────────────────

const festivalSchema = z.object({
  name: z.string().trim().min(2, "Festival name is required").max(200),
  description: optText(5000),
  river: optText(100),
  startDate: dateStr,
  endDate: dateStr,
  imageUrl: z.string().trim().max(500).optional().nullable(),
  active: z.boolean().default(true),
}).strict();

export const listFestivalsAdmin = catchAsync(async (_req: AuthRequest, res: Response) => {
  res.json(await prisma.festival.findMany({
    orderBy: { startDate: "desc" },
    include: { ghats: { orderBy: { name: "asc" } }, _count: { select: { services: true, bookings: { where: { status: { in: ["confirmed", "completed"] } } } } } },
  }));
});

export const createFestival = catchAsync(async (req: AuthRequest, res: Response) => {
  const d = festivalSchema.parse(req.body);
  if (d.endDate < d.startDate) throw new AppError("End date must be on or after the start date");
  const f = await prisma.festival.create({ data: d });
  await logAudit(actor(req), { festivalId: f.id, action: "festival.create", entityType: "festival", entityId: f.id, summary: `Created festival "${f.name}"`, after: f });
  res.status(201).json(f);
});

export const updateFestival = catchAsync(async (req: AuthRequest, res: Response) => {
  const before = await prisma.festival.findUnique({ where: { id: req.params.id } });
  if (!before) throw new AppError("Festival not found", 404);
  const d = festivalSchema.partial().strict().parse(req.body);
  if ((d.endDate ?? before.endDate) < (d.startDate ?? before.startDate)) throw new AppError("End date must be on or after the start date");
  const after = await prisma.festival.update({ where: { id: before.id }, data: d });
  await logAudit(actor(req), { festivalId: after.id, action: "festival.update", entityType: "festival", entityId: after.id, summary: `Updated festival "${after.name}"`, before, after });
  res.json(after);
});

export const deleteFestival = catchAsync(async (req: AuthRequest, res: Response) => {
  const f = await prisma.festival.findUnique({ where: { id: req.params.id }, include: { _count: { select: { bookings: true } } } });
  if (!f) throw new AppError("Festival not found", 404);
  if (f._count.bookings) {
    await prisma.festival.update({ where: { id: f.id }, data: { active: false } });
  } else {
    await prisma.festival.delete({ where: { id: f.id } });
  }
  await logAudit(actor(req), { festivalId: f._count.bookings ? f.id : null, action: f._count.bookings ? "festival.deactivate" : "festival.delete", entityType: "festival", entityId: f.id, summary: `${f._count.bookings ? "Deactivated" : "Deleted"} festival "${f.name}"` });
  res.json({ deleted: !f._count.bookings, deactivated: !!f._count.bookings });
});

const ghatSchema = z.object({
  name: z.string().trim().min(2, "Ghat name is required").max(200),
  description: optText(2000),
  city: optText(100),
  state: optText(100),
  lat: z.number().min(-90).max(90).optional().nullable(),
  lon: z.number().min(-180).max(180).optional().nullable(),
}).strict();

export const addGhat = catchAsync(async (req: AuthRequest, res: Response) => {
  const festival = await prisma.festival.findUnique({ where: { id: req.params.id } });
  if (!festival) throw new AppError("Festival not found", 404);
  const ghat = await prisma.festivalGhat.create({ data: { ...ghatSchema.parse(req.body), festivalId: festival.id } });
  await logAudit(actor(req), { festivalId: festival.id, action: "ghat.create", entityType: "ghat", entityId: ghat.id, summary: `Added ghat "${ghat.name}" to ${festival.name}`, after: ghat });
  res.status(201).json(ghat);
});

export const updateGhat = catchAsync(async (req: AuthRequest, res: Response) => {
  const before = await prisma.festivalGhat.findUnique({ where: { id: req.params.ghatId } });
  if (!before) throw new AppError("Ghat not found", 404);
  const after = await prisma.festivalGhat.update({ where: { id: before.id }, data: ghatSchema.partial().strict().parse(req.body) });
  await logAudit(actor(req), { festivalId: after.festivalId, action: "ghat.update", entityType: "ghat", entityId: after.id, summary: `Updated ghat "${after.name}"`, before, after });
  res.json(after);
});

export const deleteGhat = catchAsync(async (req: AuthRequest, res: Response) => {
  const ghat = await prisma.festivalGhat.findUnique({ where: { id: req.params.ghatId } });
  if (!ghat) throw new AppError("Ghat not found", 404);
  await prisma.festivalGhat.delete({ where: { id: ghat.id } });
  await logAudit(actor(req), { festivalId: ghat.festivalId, action: "ghat.delete", entityType: "ghat", entityId: ghat.id, summary: `Removed ghat "${ghat.name}"` });
  res.status(204).send();
});

// ── Audit & broadcast ─────────────────────────────────────────

export const globalAudit = catchAsync(async (req: AuthRequest, res: Response) => {
  const page = Math.max(1, Math.min(1000, Number(req.query.page) || 1));
  const where = {
    ...(req.query.templeId ? { templeId: String(req.query.templeId) } : {}),
    ...(req.query.festivalId ? { festivalId: String(req.query.festivalId) } : {}),
  };
  const take = 50;
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take, skip: (page - 1) * take }),
    prisma.auditLog.count({ where }),
  ]);
  const templeIds = [...new Set(items.map((i) => i.templeId).filter(Boolean))] as string[];
  const temples = await prisma.temple.findMany({ where: { id: { in: templeIds } }, select: { id: true, name: true } });
  const names = new Map(temples.map((t) => [t.id, t.name]));
  res.json({
    items: items.map((l) => ({ ...l, templeName: l.templeId ? names.get(l.templeId) ?? null : null, changes: l.changes ? JSON.parse(l.changes) : null })),
    total, page, pages: Math.max(1, Math.ceil(total / take)),
  });
});

/** Main-admin announcement to everyone, or to devotees in a town/district. */
export const broadcast = catchAsync(async (req: AuthRequest, res: Response) => {
  const d = z.object({
    title: z.string().trim().min(3).max(100),
    body: z.string().trim().min(3).max(500),
    target: z.enum(["all", "area"]),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(100).optional(),
    dryRun: z.boolean().optional(),
  }).strict().parse(req.body);
  let ids: string[];
  if (d.target === "area") {
    if (!d.city) throw new AppError("Choose a town or district");
    ids = await communityUserIds({ city: d.city, state: d.state });
  } else {
    ids = (await prisma.user.findMany({ where: { role: "devotee" }, select: { id: true } })).map((u) => u.id);
  }
  if (d.dryRun) return res.json({ targeted: ids.length });
  const notified = await notifyRecipients(ids.map((userId) => ({ userId, type: "temple_announcement" })), d.title, d.body, {});
  await logAudit(actor(req), { action: "notification.broadcast", entityType: "notification", summary: `Broadcast "${d.title}" to ${d.target === "all" ? "all devotees" : `${d.city}${d.state ? `, ${d.state}` : ""}`} (${notified} reached)` });
  res.json({ targeted: ids.length, notified });
});
