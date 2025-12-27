import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import { hydrateVerifiedDomains, isOriginAllowed } from "./config/cors";

dotenv.config();

import { apiRouter } from "./routes";

const app = express();
const uploadsPath = path.resolve(__dirname, "../uploads");

const defaultCorsOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5050",
];

const staticCorsOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .concat(defaultCorsOrigins);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX || 300),
  standardHeaders: true,
  legacyHeaders: false,
});

// Allow cross-origin usage of static assets (covers)
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

// CORS must be before static so uploads also send the headers
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // non-browser or same-origin
      if (isOriginAllowed(origin, staticCorsOrigins)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"), false);
    },
    credentials: true,
  })
);

app.use(limiter);
app.use(morgan("dev"));

// serve uploads (local)
app.use("/uploads", express.static(uploadsPath));

app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api", apiRouter);

const port = Number(process.env.PORT || 5050);

// Basic error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("Unhandled error", err);
  res.status(err?.status || 500).json({ message: err?.message || "Internal server error" });
});

app.listen(port, () => {
  console.log(`CMS Backend running on http://localhost:${port}`);
});

// Preload verified domains into CORS allowlist on startup
hydrateVerifiedDomains().catch((err) => {
  console.error("Failed to hydrate verified domains for CORS", err);
});
