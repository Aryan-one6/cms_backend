"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const routes_1 = require("./routes");
const cors_2 = require("./config/cors");
const path_1 = __importDefault(require("path"));
const app = (0, express_1.default)();
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
const limiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_MAX || 300),
    standardHeaders: true,
    legacyHeaders: false,
});
app.use((0, helmet_1.default)({
    crossOriginResourcePolicy: false,
}));
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        if (!origin)
            return callback(null, true); // non-browser or same-origin
        if ((0, cors_2.isOriginAllowed)(origin, staticCorsOrigins))
            return callback(null, true);
        return callback(new Error("Not allowed by CORS"), false);
    },
    credentials: true,
}));
app.use(limiter);
app.use((0, morgan_1.default)("dev"));
app.use(express_1.default.json({ limit: "2mb" }));
app.use((0, cookie_parser_1.default)());
app.get("/health", (_req, res) => res.json({ ok: true }));
// Serve locally stored uploads when S3 is not configured
app.use("/uploads", express_1.default.static(path_1.default.resolve(__dirname, "../uploads")));
app.use("/api", routes_1.apiRouter);
// Basic error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err, _req, res, _next) => {
    console.error("Unhandled error", err);
    res.status(err?.status || 500).json({ message: err?.message || "Internal server error" });
});
// Preload verified domains into CORS allowlist on startup
(0, cors_2.hydrateVerifiedDomains)().catch((err) => {
    console.error("Failed to hydrate verified domains for CORS", err);
});
exports.default = app;
