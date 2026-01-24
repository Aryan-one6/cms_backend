"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractDocumentMetrics = extractDocumentMetrics;
exports.analyzeCompetitors = analyzeCompetitors;
const axios_1 = __importDefault(require("axios"));
const cheerio = __importStar(require("cheerio"));
const nlp_1 = require("./nlp");
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
async function fetchHtml(url) {
    const res = await axios_1.default.get(url, {
        timeout: 12000,
        headers: {
            "User-Agent": USER_AGENT,
            Accept: "text/html,application/xhtml+xml",
        },
    });
    return res.data;
}
function toHeadingMap($) {
    const map = { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] };
    ["h1", "h2", "h3", "h4", "h5", "h6"].forEach((tag) => {
        $(tag).each((_, el) => {
            const text = (0, nlp_1.normalizeWhitespace)($(el).text());
            if (text)
                map[tag].push(text);
        });
    });
    return map;
}
function classifyLinks($, baseUrl) {
    let internal = 0;
    let external = 0;
    let baseHost = "";
    try {
        baseHost = new URL(baseUrl).hostname.replace(/^www\./, "");
    }
    catch {
        // ignore
    }
    $("a[href]").each((_, el) => {
        const href = $(el).attr("href") || "";
        if (!href || href.startsWith("#") || href.toLowerCase().startsWith("javascript"))
            return;
        try {
            const url = new URL(href, baseUrl);
            const host = url.hostname.replace(/^www\./, "");
            if (baseHost && host === baseHost)
                internal++;
            else
                external++;
        }
        catch {
            internal++;
        }
    });
    return { internal, external };
}
function detectSchema($) {
    const rawTypes = [];
    let faq = false;
    let article = false;
    $("script[type='application/ld+json']").each((_, el) => {
        try {
            const json = JSON.parse($(el).contents().text() || "{}");
            const maybeArray = Array.isArray(json) ? json : [json];
            maybeArray.forEach((entry) => {
                const typeField = entry?.["@type"];
                if (!typeField)
                    return;
                const types = Array.isArray(typeField) ? typeField : [typeField];
                types.forEach((t) => {
                    const lower = String(t || "").toLowerCase();
                    rawTypes.push(lower);
                    if (lower.includes("faq"))
                        faq = true;
                    if (lower.includes("article"))
                        article = true;
                });
            });
        }
        catch {
            // ignore parsing issues
        }
    });
    return { faq, article, rawTypes };
}
function extractDocumentMetrics(html, url, trackedTerms = []) {
    const $ = cheerio.load(html || "");
    const title = $("title").first().text() ||
        $('meta[property="og:title"]').attr("content") ||
        $('meta[name="twitter:title"]').attr("content") ||
        "";
    const metaDescription = $('meta[name="description"]').attr("content") ||
        $('meta[property="og:description"]').attr("content") ||
        $('meta[name="twitter:description"]').attr("content") ||
        "";
    const bodyHtml = $("body").html() || html;
    const rawText = (0, nlp_1.normalizeWhitespace)((0, nlp_1.stripHtml)(bodyHtml)).slice(0, 24000); // prevent oversized payloads
    const tokens = (0, nlp_1.tokenize)(rawText);
    const headings = toHeadingMap($);
    const { internal, external } = classifyLinks($, url);
    const schema = detectSchema($);
    const keywordFrequency = {};
    const uniqueTerms = Array.from(new Set(trackedTerms.map((t) => t.toLowerCase()).filter(Boolean)));
    uniqueTerms.forEach((term) => {
        keywordFrequency[term] = (0, nlp_1.countOccurrences)(rawText.toLowerCase(), term.toLowerCase());
    });
    return {
        url,
        title,
        wordCount: tokens.length,
        titleLength: title.trim().length,
        metaDescriptionLength: metaDescription.trim().length,
        headings,
        keywordFrequency,
        nlpFrequency: {},
        internalLinks: internal,
        externalLinks: external,
        imageCount: $("img").length,
        schema,
        rawText,
        averageSentenceLength: (0, nlp_1.averageSentenceLength)(rawText),
    };
}
async function analyzeCompetitors(serpResults, primaryKeyword, secondaryKeywords) {
    const trackedTerms = [primaryKeyword, ...secondaryKeywords].filter(Boolean);
    const snapshots = [];
    for (const result of serpResults.slice(0, 10)) {
        try {
            const html = await fetchHtml(result.url);
            const metrics = extractDocumentMetrics(html, result.url, trackedTerms);
            snapshots.push({
                ...metrics,
                snippet: result.snippet,
                position: result.position,
                title: result.title,
                url: result.url,
                domain: new URL(result.url).hostname,
            });
        }
        catch (err) {
            console.error("Failed to analyze competitor", result.url, err?.message || err);
            snapshots.push({
                url: result.url,
                title: result.title,
                snippet: result.snippet,
                position: result.position,
                domain: "",
                wordCount: 0,
                titleLength: 0,
                metaDescriptionLength: 0,
                headings: { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] },
                keywordFrequency: {},
                nlpFrequency: {},
                internalLinks: 0,
                externalLinks: 0,
                imageCount: 0,
                schema: { faq: false, article: false, rawTypes: [] },
                rawText: "",
                averageSentenceLength: 0,
            });
        }
    }
    return snapshots;
}
