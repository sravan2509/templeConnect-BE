import { NextFunction, Response, Request as ExpressRequest } from "express";
import { AppError } from "../utils/AppError";
import { verifyToken } from "../utils/jwt";

export interface AuthRequest extends ExpressRequest {
  userId?: string;
  userRole?: string;
}

export function requireAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const header = req.headers["authorization"] as string | undefined;
  if (!header?.startsWith("Bearer ")) {
    throw new AppError("Authentication required", 401);
  }

  const token = header.slice("Bearer ".length);
  try {
    const payload = verifyToken(token);
    req.userId = payload.userId;
    (req as any).userRole = payload.role || "devotee";
    next();
  } catch {
    throw new AppError("Invalid or expired token", 401);
  }
}
