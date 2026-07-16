import { Request, Response } from "express";
import { catchAsync } from "../utils/catchAsync";
import { knowledgeBaseArticles } from "../data/mockStore";

export const search = catchAsync(async (req: Request, res: Response) => {
  const query = (req.query.query as string | undefined)?.toLowerCase() ?? "";
  const results = query
    ? knowledgeBaseArticles.filter(
        (a) => a.title.toLowerCase().includes(query) || a.summary.toLowerCase().includes(query)
      )
    : knowledgeBaseArticles;
  res.json(results);
});

function byCategory(category: string) {
  return catchAsync(async (_req: Request, res: Response) => {
    res.json(knowledgeBaseArticles.filter((a) => a.category === category));
  });
}

export const cultural = byCategory("cultural");
export const kids = byCategory("kids");
export const etiquette = byCategory("etiquette");
