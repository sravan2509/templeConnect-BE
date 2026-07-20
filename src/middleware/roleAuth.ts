import { NextFunction, Response } from "express";
import { AuthRequest } from "./auth";
import { AppError } from "../utils/AppError";

export function requireAdmin(req: AuthRequest, _res: Response, next: NextFunction) {
  if ((req as any).userRole !== "admin") {
    throw new AppError("Admin access required", 403);
  }
  next();
}

export function requirePriest(req: AuthRequest, _res: Response, next: NextFunction) {
  if ((req as any).userRole !== "priest" && (req as any).userRole !== "admin") {
    throw new AppError("Priest access required", 403);
  }
  next();
}
