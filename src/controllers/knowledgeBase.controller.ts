import { Request, Response } from "express";
import { catchAsync } from "../utils/catchAsync";
import { prisma } from "../config/prisma";
import { knowledgeBaseArticles } from "../data/staticContent";

/**
 * Admin-written articles, plus the built-in starter articles for any category
 * that has no admin articles yet.
 */
async function allArticles() {
  const dbArticles = await prisma.knowledgeArticle.findMany({ orderBy: { createdAt: "desc" } });
  const coveredCategories = new Set(dbArticles.map((a) => a.category));
  const starters = knowledgeBaseArticles
    .filter((a) => !coveredCategories.has(a.category))
    .map((a) => ({ id: a.id, title: a.title, summary: a.summary, content: a.content, category: a.category, imageUrl: null, createdAt: null }));
  return [...dbArticles, ...starters];
}

export const search = catchAsync(async (req: Request, res: Response) => {
  const query = (req.query.query as string | undefined)?.toLowerCase().trim() ?? "";
  let articles = await allArticles();
  if (query) {
    articles = articles.filter((a) =>
      a.title.toLowerCase().includes(query) || a.summary.toLowerCase().includes(query) || a.content.toLowerCase().includes(query)
    );
  }
  res.json(articles);
});

function byCategory(category: string) {
  return catchAsync(async (_req: Request, res: Response) => {
    res.json((await allArticles()).filter((a) => a.category === category));
  });
}

export const cultural = byCategory("cultural");
export const kids = byCategory("kids");
export const etiquette = byCategory("etiquette");
