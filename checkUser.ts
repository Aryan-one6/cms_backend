import { prisma } from "./src/config/prisma";
import bcrypt from "bcrypt";

async function run() {
  const email = "parashar.one6@gmail.com";
  const user = await prisma.adminUser.findUnique({ where: { email } });
  console.log("user", user);
  if (user) {
    const ok = await bcrypt.compare("Admin@12345", user.passwordHash);
    console.log("password match?", ok);
  }
}

run().finally(() => prisma.$disconnect());
