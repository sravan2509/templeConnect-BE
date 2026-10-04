import bcrypt from "bcryptjs";
import { prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";
import { signToken } from "../utils/jwt";

type TokenUser = {
  id: string; name: string; email: string; role: string; tokenVersion: number;
  passwordHash: string | null; googleId: string | null; avatarUrl: string | null;
};

/** Public profile shape returned to the app (never the hash or Google ID themselves). */
export function publicUser(user: TokenUser) {
  return {
    id: user.id, name: user.name, email: user.email, role: user.role,
    hasPassword: !!user.passwordHash, googleLinked: !!user.googleId, avatarUrl: user.avatarUrl,
  };
}

export function issueSession(user: TokenUser) {
  const token = signToken({ userId: user.id, role: user.role, tv: user.tokenVersion });
  return { token, user: publicUser(user) };
}

export async function registerUser(name: string, email: string, password: string) {
  const lowerEmail = email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: lowerEmail } });
  if (existing) throw new AppError("Email already registered", 409);

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name: name.trim(), email: lowerEmail, passwordHash },
  });
  console.log(`[AUTH] Registered ${user.id} role=${user.role}`);
  return issueSession(user);
}

// Per-account throttle on failed logins, so guesses can't be spread across many IPs.
const MAX_FAILED_LOGINS = 8;
const LOCKOUT_MS = 15 * 60 * 1000;
const failedLogins = new Map<string, { count: number; first: number }>();

function assertNotLocked(email: string) {
  const entry = failedLogins.get(email);
  if (!entry) return;
  if (Date.now() - entry.first > LOCKOUT_MS) { failedLogins.delete(email); return; }
  if (entry.count >= MAX_FAILED_LOGINS) {
    throw new AppError("Too many failed attempts for this account. Please wait 15 minutes or reset your password.", 429);
  }
}

function recordFailedLogin(email: string) {
  const entry = failedLogins.get(email);
  if (!entry || Date.now() - entry.first > LOCKOUT_MS) failedLogins.set(email, { count: 1, first: Date.now() });
  else entry.count++;
  if (failedLogins.size > 10000) failedLogins.delete(failedLogins.keys().next().value as string);
}

export async function loginUser(email: string, password: string) {
  const lowerEmail = email.trim().toLowerCase();
  assertNotLocked(lowerEmail);
  const user = await prisma.user.findUnique({ where: { email: lowerEmail } });
  // Compare against a dummy hash when the user is missing so timing doesn't reveal which emails exist.
  const valid = await bcrypt.compare(password, user?.passwordHash ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv");
  if (user && !user.passwordHash && user.googleId) {
    throw new AppError('This account uses Google sign-in. Tap "Continue with Google", or use "Forgot password" to set a password.', 400);
  }
  if (!user || !valid) {
    recordFailedLogin(lowerEmail);
    throw new AppError("Invalid email or password", 401);
  }
  failedLogins.delete(lowerEmail);
  console.log(`[AUTH] Login ${user.id} role=${user.role}`);
  return issueSession(user);
}
