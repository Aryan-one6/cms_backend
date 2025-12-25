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
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
dotenv_1.default.config();
const routes_1 = require("./routes");
const app = (0, express_1.default)();
const uploadsPath = path_1.default.resolve(__dirname, "../uploads");
const defaultCorsOrigins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5050",
];
const limiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_MAX || 300),
    standardHeaders: true,
    legacyHeaders: false,
});
// Allow cross-origin usage of static assets (covers)
app.use((0, helmet_1.default)({
    crossOriginResourcePolicy: false,
}));
// CORS must be before static so uploads also send the headers
app.use((0, cors_1.default)({
    origin: (process.env.CORS_ORIGIN || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .concat(defaultCorsOrigins),
    credentials: true,
}));
app.use(limiter);
app.use((0, morgan_1.default)("dev"));
// serve uploads (local)
app.use("/uploads", express_1.default.static(uploadsPath));
app.use(express_1.default.json({ limit: "2mb" }));
app.use((0, cookie_parser_1.default)());
app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/api", routes_1.apiRouter);
const port = Number(process.env.PORT || 5050);
// Basic error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err, _req, res, _next) => {
    console.error("Unhandled error", err);
    res.status(err?.status || 500).json({ message: err?.message || "Internal server error" });
});
app.listen(port, () => {
    console.log(`CMS Backend running on http://localhost:${port}`);
});
