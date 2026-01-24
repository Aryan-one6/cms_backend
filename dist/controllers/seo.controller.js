"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.triggerSerpAnalysis = triggerSerpAnalysis;
exports.analyzeContent = analyzeContent;
exports.suggestSeo = suggestSeo;
const zod_1 = require("zod");
const seo_service_1 = require("../services/seo.service");
const serpSchema = zod_1.z.object({
    keyword: zod_1.z.string().min(2, "Keyword is required"),
    location: zod_1.z.string().min(2, "Location is required"),
    language: zod_1.z.string().min(2, "Language is required"),
    secondaryKeywords: zod_1.z.array(zod_1.z.string()).optional(),
});
const contentSchema = zod_1.z.object({
    serpAnalysisId: zod_1.z.string().min(1),
    contentHtml: zod_1.z.string().min(1),
    metaTitle: zod_1.z.string().optional(),
    metaDescription: zod_1.z.string().optional(),
    primaryKeyword: zod_1.z.string().optional(),
    secondaryKeywords: zod_1.z.array(zod_1.z.string()).optional(),
    baseUrl: zod_1.z.string().optional(),
    blogPostId: zod_1.z.string().optional(),
});
const suggestSchema = zod_1.z.object({
    serpAnalysisId: zod_1.z.string().min(1),
    contentHtml: zod_1.z.string().min(1),
    primaryKeyword: zod_1.z.string().optional(),
    secondaryKeywords: zod_1.z.array(zod_1.z.string()).optional(),
    missingTerms: zod_1.z.array(zod_1.z.string()).default([]),
});
function sanitizeCompetitors(raw) {
    return (raw || []).map((c) => {
        const { rawText, ...rest } = c;
        return rest;
    });
}
async function triggerSerpAnalysis(req, res) {
    const parsed = serpSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json(parsed.error.flatten());
    const auth = req.auth;
    const site = req.site;
    if (!site)
        return res.status(400).json({ message: "Site context missing" });
    try {
        const result = await (0, seo_service_1.runSerpAnalysis)({
            keyword: parsed.data.keyword.trim(),
            location: parsed.data.location.trim(),
            language: parsed.data.language.trim(),
            secondaryKeywords: parsed.data.secondaryKeywords || [],
            siteId: site.siteId,
            adminId: auth.adminId,
        });
        return res.json({
            cached: result.cached,
            analysis: {
                ...result.analysis,
                competitors: sanitizeCompetitors(result.analysis.competitors),
            },
        });
    }
    catch (err) {
        console.error("SERP analysis error", err?.message || err);
        return res.status(400).json({ message: err?.message || "Failed to run SERP analysis" });
    }
}
async function analyzeContent(req, res) {
    const parsed = contentSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json(parsed.error.flatten());
    try {
        const result = await (0, seo_service_1.analyzeContentAgainstSerp)({
            serpAnalysisId: parsed.data.serpAnalysisId,
            contentHtml: parsed.data.contentHtml,
            metaTitle: parsed.data.metaTitle,
            metaDescription: parsed.data.metaDescription,
            primaryKeyword: parsed.data.primaryKeyword,
            secondaryKeywords: parsed.data.secondaryKeywords || [],
            baseUrl: parsed.data.baseUrl,
            blogPostId: parsed.data.blogPostId,
        });
        return res.json({
            seoScore: result.score.total,
            breakdown: result.score,
            benchmarks: result.benchmarks,
            nlp: result.nlp,
        });
    }
    catch (err) {
        console.error("Content analysis error", err?.message || err);
        return res.status(400).json({ message: err?.message || "Failed to analyze content" });
    }
}
async function suggestSeo(req, res) {
    const parsed = suggestSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json(parsed.error.flatten());
    try {
        const suggestions = await (0, seo_service_1.suggestSeoAi)({
            serpAnalysisId: parsed.data.serpAnalysisId,
            primaryKeyword: parsed.data.primaryKeyword,
            secondaryKeywords: parsed.data.secondaryKeywords || [],
            missingTerms: parsed.data.missingTerms || [],
            contentHtml: parsed.data.contentHtml,
        });
        return res.json({ suggestions });
    }
    catch (err) {
        console.error("AI suggestion error", err?.message || err);
        return res.status(400).json({ message: err?.message || "Failed to generate suggestions" });
    }
}
