import bcrypt from "bcryptjs";
import { prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";
import { signToken } from "../utils/jwt";

export async function registerUser(name: string, email: string, password: string) {
  console.log(`[AUTH] Register attempt: ${email}`);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`[AUTH] Register failed: ${email} already exists`);
    throw new AppError("Email already registered", 409);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name, email, passwordHash },
  });

  const token = signToken({ userId: user.id, role: user.role });
  console.log(`[AUTH] Register success: ${user.id} role=${user.role}`);
  return { token, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
}

export async function loginUser(email: string, password: string) {
  console.log(`[AUTH] Login attempt: ${email}`);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.log(`[AUTH] Login failed: ${email} not found`);
    throw new AppError("Invalid email or password", 401);
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    console.log(`[AUTH] Login failed: wrong password for ${email}`);
    throw new AppError("Invalid email or password", 401);
  }

  const token = signToken({ userId: user.id, role: user.role });
  console.log(`[AUTH] Login success: ${user.id} role=${user.role}`);
  return { token, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
}
