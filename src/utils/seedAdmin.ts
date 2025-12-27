import bcrypt from "bcrypt";
import dotenv from "dotenv";
dotenv.config();

import { prisma } from "../config/prisma";

async function main() {
  const email = "connect@triadflair.com";
  const password = "Admin@12345";

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    console.log("Admin already exists:", email);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.adminUser.create({
    data: {
      name: "Super Admin",
      email,
      passwordHash,
      role: "SUPER_ADMIN",
    },
  });

  console.log("✅ Seeded admin:", { email, password });
}

main()
  .catch(console.error)
  .finally(async () => prisma.$disconnect());
