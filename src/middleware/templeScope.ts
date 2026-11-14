import { NextFunction, Response } from "express";
import { AuthRequest } from "./auth";
import { AppError } from "../utils/AppError";
import { prisma } from "../config/prisma";

export interface Scope {
  /** Set when acting for a temple. */
  templeId?: string;
  /** Set when the main admin manages a standalone festival (Pushkaraalu). */
  festivalId?: string;
}

export interface ScopedRequest extends AuthRequest {
  scope?: Scope;
}

/**
 * Temple portal access.
 *  - temple_admin: always scoped to their own temple (any templeId they pass is ignored).
 *  - admin: must say which temple or festival via ?templeId= / ?festivalId= (or X-Temple-Id / X-Festival-Id).
 */
export async function requireTempleScope(req: ScopedRequest, _res: Response, next: NextFunction) {
  try {
    if (req.userRole === "temple_admin") {
      const staff = await prisma.templeStaff.findUnique({ where: { userId: req.userId! }, select: { templeId: true } });
      if (!staff) return next(new AppError("Your account is not linked to a temple. Contact the Temple Connect admin.", 403));
      req.scope = { templeId: staff.templeId };
      return next();
    }
    if (req.userRole === "admin") {
      const templeId = (req.query.templeId as string) || (req.headers["x-temple-id"] as string) || undefined;
      const festivalId = (req.query.festivalId as string) || (req.headers["x-festival-id"] as string) || undefined;
      if (templeId) {
        if (!(await prisma.temple.findUnique({ where: { id: templeId }, select: { id: true } }))) return next(new AppError("Temple not found", 404));
        req.scope = { templeId };
      } else if (festivalId) {
        if (!(await prisma.festival.findUnique({ where: { id: festivalId }, select: { id: true } }))) return next(new AppError("Festival not found", 404));
        req.scope = { festivalId };
      } else {
        return next(new AppError("Choose a temple or festival to manage", 400));
      }
      return next();
    }
    next(new AppError("Temple admin access required", 403));
  } catch (err) {
    next(err);
  }
}

/** Prisma filter for records belonging to the current scope. */
export function scopeWhere(scope: Scope) {
  return scope.templeId ? { templeId: scope.templeId } : { festivalId: scope.festivalId! };
}

export function requireTempleOnly(req: ScopedRequest, _res: Response, next: NextFunction) {
  if (!req.scope?.templeId) return next(new AppError("This is only available for temples", 400));
  next();
}
