import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { apiRouter } from "./routes";
import { hydrateVerifiedDomains, isOriginAllowed } from "./config/cors";
import path from "path";

const app = express();

const defaultCorsOrigins = [
  "http://localhost:5174",
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

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

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

app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

app.get("/health", (_req, res) => res.json({ ok: true }));

// Serve locally stored uploads when S3 is not configured
app.use("/uploads", express.static(path.resolve(__dirname, "../uploads")));

app.use("/api", apiRouter);

// Basic error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("Unhandled error", err);
  res.status(err?.status || 500).json({ message: err?.message || "Internal server error" });
});

// Preload verified domains into CORS allowlist on startup
hydrateVerifiedDomains().catch((err) => {
  console.error("Failed to hydrate verified domains for CORS", err);
});

export default app;
