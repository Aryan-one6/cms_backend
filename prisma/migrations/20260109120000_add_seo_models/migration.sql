-- Add SEO fields to BlogPost
ALTER TABLE "BlogPost"
ADD COLUMN     "primaryKeyword" TEXT,
ADD COLUMN     "secondaryKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "metaTitle" TEXT,
ADD COLUMN     "metaDescription" TEXT,
ADD COLUMN     "serpAnalysisId" TEXT,
ADD COLUMN     "seoScore" INTEGER NOT NULL DEFAULT 0;

-- Create SerpAnalysis table
CREATE TABLE "SerpAnalysis" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "createdById" TEXT,
    "keyword" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "competitors" JSONB NOT NULL,
    "benchmarks" JSONB NOT NULL,
    "nlpTerms" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SerpAnalysis_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
ALTER TABLE "SerpAnalysis"
ADD CONSTRAINT "SerpAnalysis_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SerpAnalysis"
ADD CONSTRAINT "SerpAnalysis_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BlogPost"
ADD CONSTRAINT "BlogPost_serpAnalysisId_fkey" FOREIGN KEY ("serpAnalysisId") REFERENCES "SerpAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes to accelerate lookups and cache invalidation
CREATE INDEX "SerpAnalysis_siteId_keyword_location_language_idx" ON "SerpAnalysis"("siteId", "keyword", "location", "language");
CREATE INDEX "SerpAnalysis_expiresAt_idx" ON "SerpAnalysis"("expiresAt");
