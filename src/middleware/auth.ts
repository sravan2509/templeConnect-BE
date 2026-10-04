import { NextFunction, Response, Request as ExpressRequest } from "express";
import { AppError } from "../utils/AppError";
import { verifyToken } from "../utils/jwt";
import { prisma } from "../config/prisma";

export interface AuthRequest extends ExpressRequest {
  userId?: string;
  userRole?: string;
}

/**
 * Resolves a bearer token to a live user. Returns null when the token is invalid,
 * the user was deleted, or the token was issued before a password change.
 */
export async function authenticateToken(token: string): Promise<{ userId: string; role: string } | null> {
  try {
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, role: true, tokenVersion: true },
    });
    if (!user) return null;
    if ((payload.tv ?? 0) !== user.tokenVersion) return null;
    return { userId: user.id, role: user.role };
  } catch {
    return null;
  }
}

export async function requireAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const header = req.headers["authorization"] as string | undefined;
  if (!header?.startsWith("Bearer ")) {
    return next(new AppError("Authentication required", 401));
  }
  const auth = await authenticateToken(header.slice("Bearer ".length));
  if (!auth) return next(new AppError("Session expired. Please log in again.", 401));
  // Role always comes from the database so role changes apply immediately.
  req.userId = auth.userId;
  req.userRole = auth.role;
  next();
}
