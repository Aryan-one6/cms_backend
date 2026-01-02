/*
  Warnings:

  - A unique constraint covering the columns `[oauthProvider,oauthSubject]` on the table `AdminUser` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "OAuthProvider" AS ENUM ('GOOGLE', 'GITHUB');

-- DropForeignKey
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_siteId_fkey";

-- AlterTable
ALTER TABLE "AdminUser" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "oauthProvider" "OAuthProvider",
ADD COLUMN     "oauthSubject" TEXT,
ALTER COLUMN "passwordHash" DROP NOT NULL;

-- CreateTable
CREATE TABLE "AccountSubscription" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "status" TEXT NOT NULL DEFAULT 'active',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountSubscription_adminId_key" ON "AccountSubscription"("adminId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_oauthProvider_oauthSubject_key" ON "AdminUser"("oauthProvider", "oauthSubject");

-- AddForeignKey
ALTER TABLE "AccountSubscription" ADD CONSTRAINT "AccountSubscription_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
