import { Request, Response } from "express";
import { z } from "zod";
import { JwtPayload } from "../middlewares/auth";
import { SiteContext } from "../middlewares/site";
import { analyzeContentAgainstSerp, runSerpAnalysis, suggestSeoAi } from "../services/seo.service";

const serpSchema = z.object({
  keyword: z.string().min(2, "Keyword is required"),
  location: z.string().min(2, "Location is required"),
  language: z.string().min(2, "Language is required"),
  secondaryKeywords: z.array(z.string()).optional(),
});

const contentSchema = z.object({
  serpAnalysisId: z.string().min(1),
  contentHtml: z.string().min(1),
  metaTitle: z.string().optional(),
  metaDescription: z.string().optional(),
  primaryKeyword: z.string().optional(),
  secondaryKeywords: z.array(z.string()).optional(),
  baseUrl: z.string().optional(),
  blogPostId: z.string().optional(),
});

const suggestSchema = z.object({
  serpAnalysisId: z.string().min(1),
  contentHtml: z.string().min(1),
  primaryKeyword: z.string().optional(),
  secondaryKeywords: z.array(z.string()).optional(),
  missingTerms: z.array(z.string()).default([]),
});

function sanitizeCompetitors(raw: any[]) {
  return (raw || []).map((c) => {
    const { rawText, ...rest } = c;
    return rest;
  });
}

export async function triggerSerpAnalysis(req: Request, res: Response) {
  const parsed = serpSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const auth = (req as any).auth as JwtPayload;
  const site = (req as any).site as SiteContext | undefined;
  if (!site) return res.status(400).json({ message: "Site context missing" });

  try {
    const result = await runSerpAnalysis({
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
        competitors: sanitizeCompetitors(result.analysis.competitors as any[]),
      },
    });
  } catch (err: any) {
    console.error("SERP analysis error", err?.message || err);
    return res.status(400).json({ message: err?.message || "Failed to run SERP analysis" });
  }
}

export async function analyzeContent(req: Request, res: Response) {
  const parsed = contentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  try {
    const result = await analyzeContentAgainstSerp({
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
  } catch (err: any) {
    console.error("Content analysis error", err?.message || err);
    return res.status(400).json({ message: err?.message || "Failed to analyze content" });
  }
}

export async function suggestSeo(req: Request, res: Response) {
  const parsed = suggestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  try {
    const suggestions = await suggestSeoAi({
      serpAnalysisId: parsed.data.serpAnalysisId,
      primaryKeyword: parsed.data.primaryKeyword,
      secondaryKeywords: parsed.data.secondaryKeywords || [],
      missingTerms: parsed.data.missingTerms || [],
      contentHtml: parsed.data.contentHtml,
    });

    return res.json({ suggestions });
  } catch (err: any) {
    console.error("AI suggestion error", err?.message || err);
    return res.status(400).json({ message: err?.message || "Failed to generate suggestions" });
  }
}
