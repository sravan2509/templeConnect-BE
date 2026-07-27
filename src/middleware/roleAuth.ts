import { NextFunction, Response } from "express";
import { AuthRequest } from "./auth";
import { AppError } from "../utils/AppError";

export function requireAdmin(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    if (req.userRole !== "admin") {
      return next(new AppError("Admin access required", 403));
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requirePriest(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    if (req.userRole !== "priest" && req.userRole !== "admin") {
      return next(new AppError("Priest access required", 403));
    }
    next();
  } catch (err) {
    next(err);
  }
}
