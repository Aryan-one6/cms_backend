-- CreateEnum
CREATE TYPE "AdminStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "SiteStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- AlterTable
ALTER TABLE "AdminUser" ADD COLUMN     "status" "AdminStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "status" "SiteStatus" NOT NULL DEFAULT 'ACTIVE';
