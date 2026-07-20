import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../utils/AppError";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    console.error(`[APP_ERR ${err.statusCode}] ${err.message}`);
    return res.status(err.statusCode).json({ error: err.message });
  }

  if (err instanceof ZodError) {
    const messages = err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
    console.error(`[ZOD_ERR] ${messages}`);
    return res.status(400).json({ error: `Validation failed: ${messages}` });
  }

  if (err instanceof SyntaxError && "body" in err) {
    console.error("[PARSE_ERR] Invalid JSON body");
    return res.status(400).json({ error: "Invalid JSON in request body" });
  }

  console.error("[UNHANDLED_ERR]", err);
  return res.status(500).json({ error: "Internal server error" });
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: "Route not found" });
}
