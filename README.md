# PPC CMS Backend — SERP-Aware SEO

Production-grade Node/Express + Prisma backend powering the AI CMS and the new Surfer-style on-page SEO system.

## Setup
1) Install deps and generate the Prisma client
```
npm install
npm run prisma:generate
```
2) Migrate your database
```
npm run prisma:migrate
```
3) Configure environment:
- `DATABASE_URL` – PostgreSQL DSN
- `JWT_SECRET` – auth secret
- `SERP_PROVIDER` – `serpapi` (default), `dataforseo`, or `zenserp`
- Provider keys (pick the one matching `SERP_PROVIDER`):
  - `SERPAPI_KEY`
  - `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD`
  - `ZENSERP_API_KEY`
- Optional: `CORS_ORIGIN`, `RATE_LIMIT_MAX`

## New SEO Data Model
- `SerpAnalysis` (cached for 7 days): keyword, location, language, competitors snapshot, benchmarks, NLP terms.
- `BlogPost` now stores `primaryKeyword`, `secondaryKeywords[]`, `metaTitle`, `metaDescription`, `serpAnalysisId`, and `seoScore`.

Run migrations after pulling new changes to create these tables/columns.

## API Endpoints (admin)
- `POST /api/admin/seo/serp/analyze`  
  Body: `{ keyword, location, language, secondaryKeywords }`  
  Returns: cached/new SERP snapshot (top 10 organic), competitors, benchmarks, NLP terms.

- `POST /api/admin/seo/content/analyze`  
  Body: `{ serpAnalysisId, contentHtml, metaTitle?, metaDescription?, primaryKeyword?, secondaryKeywords?, baseUrl?, blogPostId? }`  
  Returns: SEO score (0–100), category breakdown, missing terms, benchmarks. If `blogPostId` is sent, the post is updated with `seoScore` and `serpAnalysisId`.

- `POST /api/admin/seo/ai/suggest`  
  Body: `{ serpAnalysisId, contentHtml, primaryKeyword?, secondaryKeywords?, missingTerms[] }`  
  Returns AI-driven headings/FAQ/gap-fill suggestions grounded in the SERP benchmarks.

## Provider Compliance
Only licensed SERP providers are used—no HTML scraping or proxy rotation. Swap providers via `SERP_PROVIDER` without changing application code.

## Plan / Rate Limits
SERP lookups are throttled per account plan (FREE/STARTER/GROWTH/PRO/ENTERPRISE). Results are cached for 7 days to control costs. Over-limit requests return a 4xx with an upgrade hint.
