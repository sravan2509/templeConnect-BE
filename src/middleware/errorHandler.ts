import { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import multer from "multer";
import { AppError } from "../utils/AppError";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    console.error(`[APP_ERR ${err.statusCode}] ${err.message}`);
    return res.status(err.statusCode).json({ error: err.message });
  }

  if (err instanceof ZodError) {
    const messages = err.errors.map((e) => (e.path.length ? `${e.path.join(".")}: ${e.message}` : e.message)).join("; ");
    console.error(`[ZOD_ERR] ${messages}`);
    return res.status(400).json({ error: `Validation failed: ${messages}` });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    console.error(`[DB_ERR ${err.code}] ${err.message.split("\n").pop()}`);
    switch (err.code) {
      case "P2025": // record to update/delete not found
        return res.status(404).json({ error: "Record not found" });
      case "P2002": // unique constraint
        return res.status(409).json({ error: "A record with these details already exists" });
      case "P2003": // foreign key constraint
        return res.status(409).json({ error: "This record is still referenced by other data and cannot be changed or deleted" });
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    console.error("[DB_VALIDATION_ERR]", err.message.split("\n").pop());
    return res.status(400).json({ error: "Invalid data supplied" });
  }

  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "File is too large (max 10 MB)" : err.message });
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
