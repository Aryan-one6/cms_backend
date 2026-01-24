import { countOccurrences } from "./nlp";
import { Benchmarks, CompetitorSnapshot, TermRecommendation } from "./types";

function avg(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function rangeFromNumbers(values: number[], padding = 0.12, floor = 0) {
  if (!values.length) return { min: floor, max: floor, avg: floor };
  const average = avg(values);
  return {
    min: Math.max(floor, Math.floor(average * (1 - padding))),
    max: Math.max(floor, Math.ceil(average * (1 + padding))),
    avg: average,
  };
}

function buildTermRecommendations(
  competitors: CompetitorSnapshot[],
  terms: string[],
  targetWordCount: number
): TermRecommendation[] {
  const deduped = Array.from(new Set(terms.map((t) => t.trim().toLowerCase()).filter(Boolean)));
  return deduped.map((term) => {
    const occurrences = competitors.map((c) => countOccurrences(c.rawText.toLowerCase(), term));
    const perThousand = occurrences.map((count, idx) => {
      const words = competitors[idx]?.wordCount || 0;
      return words ? (count / words) * 1000 : 0;
    });

    const avgPerThousand = avg(perThousand);
    const avgCountForTarget = Math.round((avgPerThousand / 1000) * Math.max(targetWordCount, 1));

    return {
      term,
      avg: avgCountForTarget,
      min: Math.max(0, Math.min(...occurrences)),
      max: Math.max(...occurrences, avgCountForTarget),
      recommended: Math.max(1, avgCountForTarget || Math.round(avg(occurrences) || 1)),
    };
  });
}

export function buildBenchmarks(
  competitors: CompetitorSnapshot[],
  primaryKeyword: string,
  nlpTerms: string[],
  secondaryKeywords: string[]
): Benchmarks {
  const wordCounts = competitors.map((c) => c.wordCount).filter((n) => n >= 0);
  const h2Counts = competitors.map((c) => c.headings.h2.length || 0);
  const h3Counts = competitors.map((c) => c.headings.h3.length || 0);
  const internalLinks = competitors.map((c) => c.internalLinks || 0);
  const externalLinks = competitors.map((c) => c.externalLinks || 0);
  const imageCounts = competitors.map((c) => c.imageCount || 0);
  const sentenceLengths = competitors.map((c) => c.averageSentenceLength || 0);

  const wordRange = rangeFromNumbers(wordCounts.length ? wordCounts : [1200], 0.18, 800);
  const primaryCounts = competitors.map(
    (c) => c.keywordFrequency?.[primaryKeyword.toLowerCase()] ?? countOccurrences(c.rawText.toLowerCase(), primaryKeyword)
  );
  const primaryRange = rangeFromNumbers(primaryCounts, 0.25, 1);

  const nlpRecommendations = buildTermRecommendations(competitors, nlpTerms.slice(0, 25), wordRange.avg || 1200);
  const secondaryRecs = buildTermRecommendations(
    competitors,
    secondaryKeywords || [],
    wordRange.avg || 1200
  ).slice(0, 15);

  return {
    wordCount: wordRange,
    headingTargets: {
      h1: 1,
      h2: Math.max(3, Math.round(avg(h2Counts) || 0)),
      h3: Math.max(2, Math.round(avg(h3Counts) || 0)),
    },
    keyword: {
      primary: primaryRange,
      secondary: secondaryRecs,
    },
    nlpTerms: nlpRecommendations,
    links: {
      internal: rangeFromNumbers(internalLinks, 0.25, 1),
      external: rangeFromNumbers(externalLinks, 0.25, 1),
    },
    media: {
      images: rangeFromNumbers(imageCounts, 0.3, 1),
    },
    readability: {
      avgSentenceLength: avg(sentenceLengths) || 16,
      targetSentenceLength: { min: 12, max: 24 },
    },
  };
}
