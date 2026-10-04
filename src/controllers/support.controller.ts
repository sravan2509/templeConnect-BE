import { Request, Response } from "express";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { AuthRequest } from "../middleware/auth";
import { prisma } from "../config/prisma";
import { CANCELLATION_WINDOW_HOURS } from "./booking.controller";

/** Shown until an admin adds FAQs of their own. */
const defaultFaqs = [
  { id: "faq-1", question: "How do I book a puja?", answer: "Go to the Connect tab → Book a Puja, choose a puja and a priest, then pick a date and time. The priest confirms the request, after which you can pay and chat with them." },
  { id: "faq-2", question: "Can I cancel a booking?", answer: `Pending requests can be cancelled at any time. Confirmed bookings can be cancelled from My Bookings up to ${CANCELLATION_WINDOW_HOURS} hours before the scheduled time.` },
  { id: "faq-3", question: "How do I get my astrology profile?", answer: "Open Home → Enter Birth Details and enter your date, time and place of birth to see your Rashi, Nakshatra and recommended deity." },
  { id: "faq-4", question: "How do I find temples near me?", answer: "Allow location access to see temples near you on the Home tab, or use Temples → Search Temples to search by name, deity, city or state." },
  { id: "faq-5", question: "Is my data secure?", answer: "Passwords are stored as salted hashes and are never visible to anyone. We never share your personal information." },
];

export const getFaqs = catchAsync(async (_req: Request, res: Response) => {
  const dbFaqs = await prisma.faq.findMany({ orderBy: { order: "asc" } });
  res.json(dbFaqs.length === 0 ? defaultFaqs : dbFaqs);
});

/** Admin view: only FAQs stored in the database (the defaults are not editable records). */
export const listAdminFaqs = catchAsync(async (_req: Request, res: Response) => {
  res.json(await prisma.faq.findMany({ orderBy: { order: "asc" } }));
});

export const createSupportTicket = catchAsync(async (req: AuthRequest, res: Response) => {
  const { subject, message } = z.object({
    subject: z.string().trim().min(1).max(150).optional(),
    message: z.string().trim().min(1, "Please describe your issue").max(5000),
  }).parse(req.body);

  const ticket = await prisma.supportTicket.create({
    data: { userId: req.userId!, subject: subject || "General Support", message },
  });
  res.status(201).json(ticket);
});

export const getSupportTickets = catchAsync(async (req: AuthRequest, res: Response) => {
  res.json(await prisma.supportTicket.findMany({ where: { userId: req.userId! }, orderBy: { createdAt: "desc" } }));
});

const faqSchema = z.object({
  question: z.string().trim().min(1).max(300),
  answer: z.string().trim().min(1).max(3000),
  category: z.string().trim().max(50).optional(),
  order: z.number().int().optional(),
}).strict();

export const createFaq = catchAsync(async (req: AuthRequest, res: Response) => {
  const data = faqSchema.parse(req.body);
  const order = data.order ?? ((await prisma.faq.aggregate({ _max: { order: true } }))._max.order ?? 0) + 1;
  res.status(201).json(await prisma.faq.create({ data: { ...data, order } }));
});

export const updateFaq = catchAsync(async (req: AuthRequest, res: Response) => {
  res.json(await prisma.faq.update({ where: { id: req.params.id }, data: faqSchema.partial().parse(req.body) }));
});

export const deleteFaq = catchAsync(async (req: AuthRequest, res: Response) => {
  await prisma.faq.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
