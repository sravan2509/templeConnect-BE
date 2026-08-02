import { Request, Response } from "express";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { AuthRequest } from "../middleware/auth";
import { prisma } from "../config/prisma";

const faqs = [
  { id: "faq-1", question: "How do I book a priest?", answer: "Go to Connect tab, browse priests, select a service, pick a date/time, and confirm booking." },
  { id: "faq-2", question: "Can I cancel a booking?", answer: "Yes, from My Bookings → Upcoming. Cancellation must be at least 2 hours before scheduled time." },
  { id: "faq-3", question: "How do I get my astrology profile?", answer: "Go to Rituals tab, enter your birth details (date, time, place) to get your Rashi, Nakshatra, and deity recommendations." },
  { id: "faq-4", question: "How do I find temples near me?", answer: "Go to Temples tab, use the search bar or map view. You can filter by deity, state, and district." },
  { id: "faq-5", question: "What is the premium membership?", answer: "Premium gives unlimited temple bookmarks, priority priest booking, and exclusive ritual recommendations." },
  { id: "faq-6", question: "Is my data secure?", answer: "Yes. Your password is hashed with bcrypt and all data is stored securely. We never share your personal information." },
];

export const getFaqs = catchAsync(async (_req: Request, res: Response) => {
  let dbFaqs = await prisma.faq.findMany({ orderBy: { order: "asc" } }).catch(() => []);
  if (dbFaqs.length === 0) {
    res.json(faqs);
  } else {
    res.json(dbFaqs);
  }
});

export const createSupportTicket = catchAsync(async (req: AuthRequest, res: Response) => {
  const { subject, message } = z.object({
    subject: z.string().min(1).optional(),
    message: z.string().min(1),
  }).parse(req.body);

  const ticket = await prisma.supportTicket.create({
    data: {
      userId: req.userId!,
      subject: subject || "General Support",
      message,
    },
  });
  res.status(201).json(ticket);
});

export const getSupportTickets = catchAsync(async (req: AuthRequest, res: Response) => {
  const tickets = await prisma.supportTicket.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: "desc" },
  });
  res.json(tickets);
});

const faqSchema = z.object({ question: z.string().min(1), answer: z.string().min(1), category: z.string().optional(), order: z.number().optional() });

export const createFaq = catchAsync(async (req: AuthRequest, res: Response) => {
  const faq = await prisma.faq.create({ data: faqSchema.parse(req.body) });
  res.status(201).json(faq);
});

export const updateFaq = catchAsync(async (req: AuthRequest, res: Response) => {
  const faq = await prisma.faq.update({ where: { id: req.params.id }, data: req.body });
  res.json(faq);
});

export const deleteFaq = catchAsync(async (req: AuthRequest, res: Response) => {
  await prisma.faq.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
