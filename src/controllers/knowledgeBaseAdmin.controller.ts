import { Request, Response } from "express";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";

const kbSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  content: z.string().min(1),
  category: z.string().min(1),
  imageUrl: z.string().nullable().optional(),
});

export const listKbArticles = catchAsync(async (req: Request, res: Response) => {
  const articles = await prisma.knowledgeArticle.findMany({
    orderBy: { createdAt: 'desc' }
  });
  res.json(articles);
});

export const createKbArticle = catchAsync(async (req: Request, res: Response) => {
  const data = kbSchema.parse(req.body);
  const article = await prisma.knowledgeArticle.create({
    data
  });
  res.status(201).json(article);
});

export const updateKbArticle = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const data = kbSchema.parse(req.body);
  const article = await prisma.knowledgeArticle.update({
    where: { id },
    data
  });
  res.json(article);
});

export const deleteKbArticle = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  await prisma.knowledgeArticle.delete({
    where: { id }
  });
  res.status(204).send();
});
