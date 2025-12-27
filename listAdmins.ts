import { prisma } from "./src/config/prisma";

async function run() {
  const users = await prisma.adminUser.findMany();
  console.log(users);
}

run().finally(() => prisma.$disconnect());
