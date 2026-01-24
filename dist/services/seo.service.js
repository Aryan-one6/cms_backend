"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSerpAnalysis = runSerpAnalysis;
exports.analyzeContentAgainstSerp = analyzeContentAgainstSerp;
exports.suggestSeoAi = suggestSeoAi;
const client_1 = require("@prisma/client");
const prisma_1 = require("../config/prisma");
const benchmarks_1 = require("../seo/benchmarks");
const competitorAnalyzer_1 = require("../seo/competitorAnalyzer");
const insights_1 = require("../seo/insights");
const serpProviders_1 = require("../seo/serpProviders");
const aiSuggestions_1 = require("../seo/aiSuggestions");
const scoring_1 = require("../seo/scoring");
const accountSubscription_1 = require("../utils/accountSubscription");
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SERP_ANALYSIS_LIMITS = {
    [client_1.Plan.FREE]: 2,
    [client_1.Plan.STARTER]: 8,
    [client_1.Plan.GROWTH]: 20,
    [client_1.Plan.PRO]: 50,
    [client_1.Plan.ENTERPRISE]: 200,
};
async function enforcePlanLimit(adminId, siteId) {
    const plan = await (0, accountSubscription_1.getAccountPlan)(adminId);
    const limit = SERP_ANALYSIS_LIMITS[plan] ?? 3;
    const since = new Date();
    since.setDate(since.getDate() - 1);
    const used = await prisma_1.prisma.serpAnalysis.count({
        where: { createdById: adminId, siteId, createdAt: { gte: since } },
    });
    if (used >= limit) {
        throw new Error(`SERP analysis limit reached for your ${plan} plan. Try again later or upgrade.`);
    }
    return plan;
}
async function runSerpAnalysis(input) {
    const cached = await prisma_1.prisma.serpAnalysis.findFirst({
        where: {
            keyword: input.keyword,
            location: input.location,
            language: input.language,
            siteId: input.siteId,
            expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
    });
    if (cached)
        return { analysis: cached, cached: true };
    await enforcePlanLimit(input.adminId, input.siteId);
    const provider = (0, serpProviders_1.getSerpProvider)();
    const serpResults = await provider.fetchOrganicResults({
        keyword: input.keyword,
        location: input.location,
        language: input.language,
        num: 10,
    });
    const competitors = await (0, competitorAnalyzer_1.analyzeCompetitors)(serpResults, input.keyword, input.secondaryKeywords || []);
    const nlp = (0, insights_1.extractNlpSignals)(competitors);
    const nlpTermsFlat = Array.from(new Set([
        ...nlp.topTerms.map((t) => t.term),
        ...nlp.semanticPhrases.map((t) => t.term),
    ]));
    const benchmarks = (0, benchmarks_1.buildBenchmarks)(competitors, input.keyword, nlpTermsFlat, input.secondaryKeywords || []);
    const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
    const record = await prisma_1.prisma.serpAnalysis.create({
        data: {
            siteId: input.siteId,
            createdById: input.adminId,
            keyword: input.keyword,
            location: input.location,
            language: input.language,
            competitors,
            benchmarks,
            nlpTerms: nlp,
            expiresAt,
        },
    });
    return { analysis: record, cached: false };
}
async function analyzeContentAgainstSerp(input) {
    const analysis = await prisma_1.prisma.serpAnalysis.findUnique({ where: { id: input.serpAnalysisId } });
    if (!analysis)
        throw new Error("SERP analysis not found");
    const benchmarks = analysis.benchmarks;
    const nlp = analysis.nlpTerms;
    const primaryKeyword = input.primaryKeyword || analysis.keyword;
    const secondaryKeywords = input.secondaryKeywords || [];
    const nlpTerms = Array.from(new Set([
        ...(nlp?.topTerms || []).map((t) => t.term),
        ...(nlp?.semanticPhrases || []).map((t) => t.term),
    ]));
    const score = (0, scoring_1.scoreContentAgainstBenchmarks)({
        contentHtml: input.contentHtml,
        metaTitle: input.metaTitle,
        metaDescription: input.metaDescription,
        primaryKeyword,
        secondaryKeywords,
        nlpTerms,
        benchmarks,
        baseUrl: input.baseUrl,
    });
    if (input.blogPostId) {
        await prisma_1.prisma.blogPost.update({
            where: { id: input.blogPostId },
            data: {
                seoScore: score.total,
                serpAnalysisId: analysis.id,
                primaryKeyword,
                secondaryKeywords,
                metaTitle: input.metaTitle || undefined,
                metaDescription: input.metaDescription || undefined,
            },
        });
    }
    return { score, benchmarks, nlp };
}
async function suggestSeoAi(input) {
    const analysis = await prisma_1.prisma.serpAnalysis.findUnique({ where: { id: input.serpAnalysisId } });
    if (!analysis)
        throw new Error("SERP analysis not found");
    const benchmarks = analysis.benchmarks;
    const nlp = analysis.nlpTerms;
    const questions = nlp?.questions || [];
    const primaryKeyword = input.primaryKeyword || analysis.keyword;
    const suggestions = await (0, aiSuggestions_1.generateSeoSuggestions)({
        primaryKeyword,
        secondaryKeywords: input.secondaryKeywords || [],
        missingTerms: input.missingTerms || [],
        benchmarks,
        questions,
        contentHtml: input.contentHtml,
    });
    return suggestions;
}
