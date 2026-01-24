import axios from "axios";
import * as cheerio from "cheerio";
import { averageSentenceLength, countOccurrences, normalizeWhitespace, stripHtml, tokenize } from "./nlp";
import { CompetitorSnapshot, DocumentMetrics, OrganicResult } from "./types";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchHtml(url: string) {
  const res = await axios.get(url, {
    timeout: 12000,
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
  });
  return res.data as string;
}

function toHeadingMap($: cheerio.CheerioAPI) {
  const map = { h1: [] as string[], h2: [] as string[], h3: [] as string[], h4: [] as string[], h5: [] as string[], h6: [] as string[] };
  ["h1", "h2", "h3", "h4", "h5", "h6"].forEach((tag) => {
    $(tag).each((_, el) => {
      const text = normalizeWhitespace($(el).text());
      if (text) (map as any)[tag].push(text);
    });
  });
  return map;
}

function classifyLinks($: cheerio.CheerioAPI, baseUrl: string) {
  let internal = 0;
  let external = 0;
  let baseHost = "";
  try {
    baseHost = new URL(baseUrl).hostname.replace(/^www\./, "");
  } catch {
    // ignore
  }

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (!href || href.startsWith("#") || href.toLowerCase().startsWith("javascript")) return;

    try {
      const url = new URL(href, baseUrl);
      const host = url.hostname.replace(/^www\./, "");
      if (baseHost && host === baseHost) internal++;
      else external++;
    } catch {
      internal++;
    }
  });

  return { internal, external };
}

function detectSchema($: cheerio.CheerioAPI) {
  const rawTypes: string[] = [];
  let faq = false;
  let article = false;

  $("script[type='application/ld+json']").each((_, el) => {
    try {
      const json = JSON.parse($(el).contents().text() || "{}");
      const maybeArray = Array.isArray(json) ? json : [json];
      maybeArray.forEach((entry) => {
        const typeField = entry?.["@type"];
        if (!typeField) return;
        const types = Array.isArray(typeField) ? typeField : [typeField];
        types.forEach((t) => {
          const lower = String(t || "").toLowerCase();
          rawTypes.push(lower);
          if (lower.includes("faq")) faq = true;
          if (lower.includes("article")) article = true;
        });
      });
    } catch {
      // ignore parsing issues
    }
  });

  return { faq, article, rawTypes };
}

export function extractDocumentMetrics(html: string, url: string, trackedTerms: string[] = []): DocumentMetrics {
  const $ = cheerio.load(html || "");

  const title =
    $("title").first().text() ||
    $('meta[property="og:title"]').attr("content") ||
    $('meta[name="twitter:title"]').attr("content") ||
    "";

  const metaDescription =
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    $('meta[name="twitter:description"]').attr("content") ||
    "";

  const bodyHtml = $("body").html() || html;
  const rawText = normalizeWhitespace(stripHtml(bodyHtml)).slice(0, 24000); // prevent oversized payloads
  const tokens = tokenize(rawText);
  const headings = toHeadingMap($);
  const { internal, external } = classifyLinks($, url);
  const schema = detectSchema($);

  const keywordFrequency: Record<string, number> = {};
  const uniqueTerms = Array.from(new Set(trackedTerms.map((t) => t.toLowerCase()).filter(Boolean)));
  uniqueTerms.forEach((term) => {
    keywordFrequency[term] = countOccurrences(rawText.toLowerCase(), term.toLowerCase());
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
    averageSentenceLength: averageSentenceLength(rawText),
  };
}

export async function analyzeCompetitors(
  serpResults: OrganicResult[],
  primaryKeyword: string,
  secondaryKeywords: string[]
) {
  const trackedTerms = [primaryKeyword, ...secondaryKeywords].filter(Boolean);
  const snapshots: CompetitorSnapshot[] = [];

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
    } catch (err: any) {
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
