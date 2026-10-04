import { Request, Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { createHash, randomInt } from "crypto";
import { catchAsync } from "../utils/catchAsync";
import { issueSession, loginUser, registerUser } from "../services/auth.service";
import { prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";
import { AuthRequest } from "../middleware/auth";
import { env } from "../config/env";
import { sendEmail } from "../services/email.service";
import { continueWithGoogle } from "../services/googleAuth.service";

const RESET_CODE_TTL_MS = 15 * 60 * 1000;
const MAX_RESET_ATTEMPTS = 5;

const password = z.string().min(8, "Password must be at least 8 characters").max(128);

const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z.string().trim().email("Enter a valid email"),
  password,
});

const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

const forgotPasswordSchema = z.object({ email: z.string().trim().email("Enter a valid email") });

const resetPasswordSchema = z.object({
  email: z.string().trim().email(),
  token: z.string().regex(/^\d{6}$/, "Reset code must be 6 digits"),
  newPassword: password,
});

const changePasswordSchema = z.object({
  // Optional only for Google accounts that don't have a password yet.
  oldPassword: z.string().optional(),
  newPassword: password,
});

const hashCode = (code: string) => createHash("sha256").update(code).digest("hex");

export const register = catchAsync(async (req: Request, res: Response) => {
  const { name, email, password } = registerSchema.parse(req.body);
  res.status(201).json(await registerUser(name, email, password));
});

export const login = catchAsync(async (req: Request, res: Response) => {
  const { email, password } = loginSchema.parse(req.body);
  res.status(200).json(await loginUser(email, password));
});

export const forgotPassword = catchAsync(async (req: Request, res: Response) => {
  const { email } = forgotPasswordSchema.parse(req.body);
  const lowerEmail = email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: lowerEmail } });
  // Same response whether or not the account exists, so emails can't be enumerated.
  const response: Record<string, string> = { message: "If an account exists for this email, a reset code has been sent." };

  if (user) {
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken: hashCode(code), resetTokenExpiry: new Date(Date.now() + RESET_CODE_TTL_MS), resetAttempts: 0 },
    });
    await sendEmail(lowerEmail, "Your Temple Connect password reset code",
      `Your password reset code is ${code}. It expires in 15 minutes.\n\nIf you did not request this, you can ignore this email.`);
    if (env.exposeResetCode) response.devCode = code;
  }

  res.json(response);
});

export const resetPassword = catchAsync(async (req: Request, res: Response) => {
  const { email, token, newPassword } = resetPasswordSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  const invalid = new AppError("Invalid or expired reset code", 400);
  if (!user || !user.resetToken || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) throw invalid;

  if (user.resetAttempts >= MAX_RESET_ATTEMPTS) {
    await prisma.user.update({ where: { id: user.id }, data: { resetToken: null, resetTokenExpiry: null } });
    throw new AppError("Too many incorrect attempts. Please request a new code.", 429);
  }

  if (user.resetToken !== hashCode(token)) {
    await prisma.user.update({ where: { id: user.id }, data: { resetAttempts: { increment: 1 } } });
    throw invalid;
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, resetToken: null, resetTokenExpiry: null, resetAttempts: 0, tokenVersion: { increment: 1 } },
  });

  res.json({ message: "Password reset successful" });
});

export const changePassword = catchAsync(async (req: AuthRequest, res: Response) => {
  const { oldPassword, newPassword } = changePasswordSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) throw new AppError("User not found", 404);

  if (user.passwordHash) {
    if (!oldPassword) throw new AppError("Current password is required", 400);
    const isValid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!isValid) throw new AppError("Current password is incorrect", 400);
    if (oldPassword === newPassword) throw new AppError("New password must be different from the current one", 400);
  }
  // Google-only accounts (no password yet) are already signed in, so they can set one directly.

  const passwordHash = await bcrypt.hash(newPassword, 10);
  // Bumping tokenVersion signs out every other session; this device gets a fresh token.
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, tokenVersion: { increment: 1 } },
  });

  res.json({ message: user.passwordHash ? "Password changed successfully" : "Password set successfully", ...issueSession(updated) });
});

export const googleSignIn = catchAsync(async (req: Request, res: Response) => {
  const { idToken } = z.object({ idToken: z.string().min(20, "Missing Google token").max(5000) }).parse(req.body);
  const result = await continueWithGoogle(idToken);
  res.status(result.isNewUser ? 201 : 200).json(result);
});
