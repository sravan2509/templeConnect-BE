import { Request, Response } from "express";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { prisma } from "../config/prisma";

export const KB_CATEGORIES = ["cultural", "kids", "etiquette"] as const;

const kbSchema = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(500).optional(),
  content: z.string().trim().min(1).max(20000),
  category: z.enum(KB_CATEGORIES, { errorMap: () => ({ message: `Category must be one of: ${KB_CATEGORIES.join(", ")}` }) }),
  imageUrl: z.string().trim().url().refine((u) => /^https:\/\//i.test(u), "Image URL must start with https://").nullable().optional(),
}).strict();

/** Uses the given summary, or the first ~160 characters of the content. */
function withSummary<T extends { summary?: string; content?: string }>(data: T) {
  if (data.summary || !data.content) return data;
  const text = data.content.replace(/\s+/g, " ");
  return { ...data, summary: text.length > 160 ? `${text.slice(0, 157)}...` : text };
}

export const listKbArticles = catchAsync(async (_req: Request, res: Response) => {
  res.json(await prisma.knowledgeArticle.findMany({ orderBy: { createdAt: "desc" } }));
});

export const createKbArticle = catchAsync(async (req: Request, res: Response) => {
  const data = withSummary(kbSchema.parse(req.body)) as z.infer<typeof kbSchema> & { summary: string };
  res.status(201).json(await prisma.knowledgeArticle.create({ data }));
});

export const updateKbArticle = catchAsync(async (req: Request, res: Response) => {
  const data = withSummary(kbSchema.partial().parse(req.body));
  res.json(await prisma.knowledgeArticle.update({ where: { id: req.params.id }, data }));
});

export const deleteKbArticle = catchAsync(async (req: Request, res: Response) => {
  await prisma.knowledgeArticle.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
