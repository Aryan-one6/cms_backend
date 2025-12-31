import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const superAdmins = await prisma.adminUser.findMany({
    where: { role: "SUPER_ADMIN" },
    select: { id: true, email: true },
  });

  console.log("Super admins to keep:", superAdmins.map((s) => `${s.id} (${s.email})`));

  await prisma.blogPostTag.deleteMany();
  await prisma.blogPost.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.apiToken.deleteMany();
  await prisma.siteDomain.deleteMany();
  await prisma.adminSiteMembership.deleteMany();
  await prisma.site.deleteMany();
  await prisma.adminUser.deleteMany({ where: { role: { not: "SUPER_ADMIN" } } });

  console.log("Cleanup complete (kept super admins).");
}

main()
  .catch((err) => {
    console.error("Cleanup failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
