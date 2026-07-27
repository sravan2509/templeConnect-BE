import { Request, Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { catchAsync } from "../utils/catchAsync";
import { loginUser, registerUser } from "../services/auth.service";
import { prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";
import { AuthRequest } from "../middleware/auth";

const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  email: z.string().email(),
  token: z.string().min(6),
  newPassword: z.string().min(8),
});

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export const register = catchAsync(async (req: Request, res: Response) => {
  const { name, email, password } = registerSchema.parse(req.body);
  const result = await registerUser(name, email, password);
  res.status(201).json(result);
});

export const login = catchAsync(async (req: Request, res: Response) => {
  const { email, password } = loginSchema.parse(req.body);
  const result = await loginUser(email, password);
  res.status(200).json(result);
});

export const forgotPassword = catchAsync(async (req: Request, res: Response) => {
  const { email } = forgotPasswordSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) throw new AppError("User not found", 404);

  const resetToken = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digit code
  const resetTokenExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

  await prisma.user.update({
    where: { id: user.id },
    data: { resetToken, resetTokenExpiry }
  });

  // Mock sending email
  console.log(`[Email Mock] Password reset code for ${email} is ${resetToken}`);
  
  res.json({ message: "Reset code generated", code: resetToken });
});

export const resetPassword = catchAsync(async (req: Request, res: Response) => {
  const { email, token, newPassword } = resetPasswordSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) throw new AppError("Invalid request", 400);

  if (user.resetToken !== token || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
    throw new AppError("Invalid or expired reset code", 400);
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, resetToken: null, resetTokenExpiry: null }
  });

  res.json({ message: "Password reset successful" });
});

export const changePassword = catchAsync(async (req: AuthRequest, res: Response) => {
  const { oldPassword, newPassword } = changePasswordSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) throw new AppError("User not found", 404);

  const isValid = await bcrypt.compare(oldPassword, user.passwordHash);
  if (!isValid) throw new AppError("Incorrect old password", 400);

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash }
  });

  res.json({ message: "Password changed successfully" });
});
