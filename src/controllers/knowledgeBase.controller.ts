import { Request, Response } from "express";
import { catchAsync } from "../utils/catchAsync";
import { prisma } from "../config/prisma";
import { knowledgeBaseArticles } from "../data/mockStore";

export const search = catchAsync(async (req: Request, res: Response) => {
  const query = (req.query.query as string | undefined)?.toLowerCase() ?? "";

  let articles = await prisma.knowledgeArticle.findMany().catch(() => []);
  if (articles.length === 0) {
    articles = knowledgeBaseArticles.map((a, i) => ({
      id: a.id,
      title: a.title,
      summary: a.summary,
      content: a.summary,
      category: a.category,
      imageUrl: null,
      createdAt: new Date(),
    })) as any;
  }

  if (query) {
    articles = articles.filter((a: any) =>
      a.title.toLowerCase().includes(query) || a.summary.toLowerCase().includes(query)
    );
  }

  res.json(articles);
});

function byCategory(category: string) {
  return catchAsync(async (req: Request, res: Response) => {
    let articles = await prisma.knowledgeArticle.findMany({ where: { category } }).catch(() => []);
    if (articles.length === 0) {
      articles = knowledgeBaseArticles
        .filter((a) => a.category === category)
        .map((a) => ({
          id: a.id,
          title: a.title,
          summary: a.summary,
          content: a.summary,
          category: a.category,
          imageUrl: null,
          createdAt: new Date(),
        })) as any;
    }
    res.json(articles);
  });
}

export const cultural = byCategory("cultural");
export const kids = byCategory("kids");
export const etiquette = byCategory("etiquette");
