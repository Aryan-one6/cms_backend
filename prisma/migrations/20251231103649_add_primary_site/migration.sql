-- AlterTable
ALTER TABLE "AdminUser" ADD COLUMN     "primarySiteId" TEXT;

-- AddForeignKey
ALTER TABLE "AdminUser" ADD CONSTRAINT "AdminUser_primarySiteId_fkey" FOREIGN KEY ("primarySiteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
