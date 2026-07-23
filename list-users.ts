import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function listUsers() {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        passwordHash: true,
        role: true
      }
    });
    
    console.log("Users in Database:");
    console.table(users);
  } catch (err) {
    console.error("Error fetching users:", err);
  } finally {
    await prisma.$disconnect();
  }
}

listUsers();
