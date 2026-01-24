// @ts-nocheck
import bcrypt from "bcrypt";
import { prisma } from "../config/prisma";

async function run() {
  const email = process.env.SUPER_ADMIN_EMAIL || "connect@triadflair.com";
  const password = process.env.SUPER_ADMIN_PASSWORD || "Aryan@321";
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.adminUser.upsert({
    where: { email },
    // Casts are used to avoid stale client typings when status enum was recently added.
    update: { passwordHash, role: "SUPER_ADMIN", status: "ACTIVE" } as any,
    create: { name: "Super Admin", email, passwordHash, role: "SUPER_ADMIN", status: "ACTIVE" } as any,
  });

  console.log("Upserted super admin", { email: user.email, role: user.role, status: (user as any).status });
}

run()
  .catch((err) => {
    console.error(err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
