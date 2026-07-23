import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function makeAdmin(email: string) {
  try {
    const user = await prisma.user.update({
      where: { email },
      data: { role: "admin" }
    });
    console.log(`Successfully promoted ${user.name} (${user.email}) to admin.`);
  } catch (err: any) {
    if (err.code === 'P2025') {
      console.error(`User with email ${email} not found.`);
    } else {
      console.error("Error updating user:", err);
    }
  } finally {
    await prisma.$disconnect();
  }
}

const emailArg = process.argv[2];
if (!emailArg) {
  console.log("Usage: npx tsx create-admin.ts <email>");
  process.exit(1);
}

makeAdmin(emailArg);
