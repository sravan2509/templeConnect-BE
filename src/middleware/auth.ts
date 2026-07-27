import { NextFunction, Response, Request as ExpressRequest } from "express";
import { AppError } from "../utils/AppError";
import { verifyToken } from "../utils/jwt";

export interface AuthRequest extends ExpressRequest {
  userId?: string;
  userRole?: string;
}

export function requireAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    const header = req.headers["authorization"] as string | undefined;
    if (!header?.startsWith("Bearer ")) {
      return next(new AppError("Authentication required", 401));
    }
    const token = header.slice("Bearer ".length);
    const payload = verifyToken(token);
    req.userId = payload.userId;
    req.userRole = payload.role || "devotee";
    next();
  } catch (err) {
    next(err instanceof AppError ? err : new AppError("Invalid or expired token", 401));
  }
}
