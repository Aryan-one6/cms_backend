
import "dotenv/config";
import { defineConfig } from "prisma/config";

const databaseUrl =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_PRISMA_URL ??
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.POSTGRES_URL;

if (!databaseUrl) {
  throw new Error(
    "Missing database connection string. Set DATABASE_URL or a Vercel Postgres env (POSTGRES_PRISMA_URL/POSTGRES_URL_NON_POOLING/POSTGRES_URL).",
  );
}

// Ensure prisma.schema env() sees the resolved value
process.env.DATABASE_URL = databaseUrl;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  engine: "classic",
  datasource: {
    url: databaseUrl,
  },
});
