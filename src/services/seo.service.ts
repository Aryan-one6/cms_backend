import { Plan } from "@prisma/client";
import { prisma } from "../config/prisma";
import { buildBenchmarks } from "../seo/benchmarks";
import { analyzeCompetitors } from "../seo/competitorAnalyzer";
import { extractNlpSignals } from "../seo/insights";
import { getSerpProvider } from "../seo/serpProviders";
import { generateSeoSuggestions } from "../seo/aiSuggestions";
import { scoreContentAgainstBenchmarks } from "../seo/scoring";
import { Benchmarks, NlpExtraction } from "../seo/types";
import { getAccountPlan } from "../utils/accountSubscription";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const SERP_ANALYSIS_LIMITS: Record<Plan, number> = {
  [Plan.FREE]: 2,
  [Plan.STARTER]: 8,
  [Plan.GROWTH]: 20,
  [Plan.PRO]: 50,
  [Plan.ENTERPRISE]: 200,
};

type RunAnalysisInput = {
  keyword: string;
  location: string;
  language: string;
  secondaryKeywords: string[];
  siteId: string;
  adminId: string;
};

async function enforcePlanLimit(adminId: string, siteId: string) {
  const plan = await getAccountPlan(adminId);
  const limit = SERP_ANALYSIS_LIMITS[plan] ?? 3;
  const since = new Date();
  since.setDate(since.getDate() - 1);

  const used = await prisma.serpAnalysis.count({
    where: { createdById: adminId, siteId, createdAt: { gte: since } },
  });
  if (used >= limit) {
    throw new Error(`SERP analysis limit reached for your ${plan} plan. Try again later or upgrade.`);
  }
  return plan;
}

export async function runSerpAnalysis(input: RunAnalysisInput) {
  const cached = await prisma.serpAnalysis.findFirst({
    where: {
      keyword: input.keyword,
      location: input.location,
      language: input.language,
      siteId: input.siteId,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
  if (cached) return { analysis: cached, cached: true };

  await enforcePlanLimit(input.adminId, input.siteId);

  const provider = getSerpProvider();
  const serpResults = await provider.fetchOrganicResults({
    keyword: input.keyword,
    location: input.location,
    language: input.language,
    num: 10,
  });

  const competitors = await analyzeCompetitors(serpResults, input.keyword, input.secondaryKeywords || []);
  const nlp: NlpExtraction = extractNlpSignals(competitors);
  const nlpTermsFlat = Array.from(
    new Set([
      ...nlp.topTerms.map((t) => t.term),
      ...nlp.semanticPhrases.map((t) => t.term),
    ])
  );
  const benchmarks = buildBenchmarks(competitors, input.keyword, nlpTermsFlat, input.secondaryKeywords || []);

  const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
  const record = await prisma.serpAnalysis.create({
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

type ContentAnalysisInput = {
  serpAnalysisId: string;
  contentHtml: string;
  metaTitle?: string;
  metaDescription?: string;
  primaryKeyword?: string;
  secondaryKeywords?: string[];
  baseUrl?: string;
  blogPostId?: string;
};

export async function analyzeContentAgainstSerp(input: ContentAnalysisInput) {
  const analysis = await prisma.serpAnalysis.findUnique({ where: { id: input.serpAnalysisId } });
  if (!analysis) throw new Error("SERP analysis not found");

  const benchmarks = analysis.benchmarks as Benchmarks;
  const nlp = analysis.nlpTerms as NlpExtraction;
  const primaryKeyword = input.primaryKeyword || analysis.keyword;
  const secondaryKeywords = input.secondaryKeywords || [];
  const nlpTerms = Array.from(
    new Set([
      ...(nlp?.topTerms || []).map((t) => t.term),
      ...(nlp?.semanticPhrases || []).map((t) => t.term),
    ])
  );

  const score = scoreContentAgainstBenchmarks({
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
    await prisma.blogPost.update({
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

type SuggestInput = {
  serpAnalysisId: string;
  primaryKeyword?: string;
  secondaryKeywords?: string[];
  missingTerms: string[];
  contentHtml: string;
};

export async function suggestSeoAi(input: SuggestInput) {
  const analysis = await prisma.serpAnalysis.findUnique({ where: { id: input.serpAnalysisId } });
  if (!analysis) throw new Error("SERP analysis not found");

  const benchmarks = analysis.benchmarks as Benchmarks;
  const nlp = analysis.nlpTerms as NlpExtraction;
  const questions = nlp?.questions || [];
  const primaryKeyword = input.primaryKeyword || analysis.keyword;

  const suggestions = await generateSeoSuggestions({
    primaryKeyword,
    secondaryKeywords: input.secondaryKeywords || [],
    missingTerms: input.missingTerms || [],
    benchmarks,
    questions,
    contentHtml: input.contentHtml,
  });

  return suggestions;
}
