"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scoreContentAgainstBenchmarks = scoreContentAgainstBenchmarks;
const competitorAnalyzer_1 = require("./competitorAnalyzer");
const nlp_1 = require("./nlp");
function scoreForRange(value, min, max) {
    if (value === 0 && min === 0 && max === 0)
        return 100;
    if (value >= min && value <= max)
        return 100;
    if (max === 0)
        return 0;
    if (value < min)
        return Math.max(0, Math.round((value / min) * 100));
    return Math.max(0, Math.round((max / value) * 100));
}
function normalizeWeights(weights) {
    const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
    const factor = 100 / total;
    return Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, v * factor]));
}
function scoreContentAgainstBenchmarks(input) {
    const { contentHtml, metaTitle = "", metaDescription = "", primaryKeyword, secondaryKeywords, nlpTerms, benchmarks, baseUrl = "http://localhost", } = input;
    const trackedTerms = [primaryKeyword, ...secondaryKeywords, ...nlpTerms];
    const metrics = (0, competitorAnalyzer_1.extractDocumentMetrics)(contentHtml || "<p></p>", baseUrl, trackedTerms);
    // Override title/meta fields with provided values when present
    const effectiveTitle = metaTitle || metrics.title || "";
    const effectiveDescription = metaDescription || "";
    const keywordLower = primaryKeyword.toLowerCase();
    const primaryFrequency = metrics.keywordFrequency[keywordLower] || (0, nlp_1.countOccurrences)(metrics.rawText.toLowerCase(), keywordLower);
    const secondaryMissing = [];
    const nlpMissing = [];
    const overOptimized = [];
    const actionable = [];
    const keywordCounts = {};
    secondaryKeywords.forEach((term) => {
        const lc = term.toLowerCase();
        const freq = metrics.keywordFrequency[lc] || (0, nlp_1.countOccurrences)(metrics.rawText.toLowerCase(), lc);
        keywordCounts[term] = freq;
        if (!freq)
            secondaryMissing.push(term);
    });
    const nlpTargetTerms = (benchmarks.nlpTerms || []).map((t) => t.term.toLowerCase());
    nlpTargetTerms.forEach((term) => {
        const freq = metrics.keywordFrequency[term] || (0, nlp_1.countOccurrences)(metrics.rawText.toLowerCase(), term);
        keywordCounts[term] = freq;
        if (!freq)
            nlpMissing.push(term);
    });
    if (benchmarks.keyword.primary.max && primaryFrequency > benchmarks.keyword.primary.max * 1.5) {
        overOptimized.push(`Primary keyword appears ${primaryFrequency} times (reduce below ${benchmarks.keyword.primary.max}).`);
    }
    const lengthScore = scoreForRange(metrics.wordCount, benchmarks.wordCount.min, benchmarks.wordCount.max);
    const keywordPlacementScore = (() => {
        const inTitle = effectiveTitle.toLowerCase().includes(keywordLower);
        const inH1 = metrics.headings.h1.some((h) => h.toLowerCase().includes(keywordLower));
        const inH2 = metrics.headings.h2.some((h) => h.toLowerCase().includes(keywordLower));
        const bodyScore = scoreForRange(primaryFrequency, benchmarks.keyword.primary.min, benchmarks.keyword.primary.max);
        const placement = [inTitle, inH1, inH2].filter(Boolean).length;
        const placementScore = placement === 0 ? 30 : placement === 1 ? 55 : placement === 2 ? 80 : 100;
        return Math.round((placementScore * 0.4) + (bodyScore * 0.6));
    })();
    const nlpCoverageScore = (() => {
        const target = Math.max(1, nlpTargetTerms.length);
        const covered = nlpTargetTerms.filter((term) => metrics.rawText.toLowerCase().includes(term)).length;
        return Math.round((covered / target) * 100);
    })();
    const headingScore = (() => {
        const h2Score = scoreForRange(metrics.headings.h2.length, benchmarks.headingTargets.h2, benchmarks.headingTargets.h2 + 2);
        const h3Score = scoreForRange(metrics.headings.h3.length, benchmarks.headingTargets.h3, benchmarks.headingTargets.h3 + 3);
        const hasH1 = metrics.headings.h1.length >= 1;
        const structureScore = hasH1 ? 100 : 55;
        if (!hasH1)
            actionable.push("Add a single H1 that includes the primary keyword.");
        return Math.round((structureScore * 0.3) + (h2Score * 0.4) + (h3Score * 0.3));
    })();
    const metaScore = (() => {
        const titleLen = effectiveTitle.trim().length;
        const descLen = effectiveDescription.trim().length;
        const titleScore = scoreForRange(titleLen, 45, 65);
        const descScore = scoreForRange(descLen, 120, 180);
        const keywordInTitle = effectiveTitle.toLowerCase().includes(keywordLower) ? 100 : 60;
        return Math.round(titleScore * 0.4 + descScore * 0.3 + keywordInTitle * 0.3);
    })();
    const linkScore = (() => {
        const internal = scoreForRange(metrics.internalLinks, benchmarks.links.internal.min, benchmarks.links.internal.max);
        const external = scoreForRange(metrics.externalLinks, benchmarks.links.external.min, benchmarks.links.external.max);
        return Math.round(internal * 0.6 + external * 0.4);
    })();
    const mediaScore = scoreForRange(metrics.imageCount, benchmarks.media.images.min, benchmarks.media.images.max);
    const readabilityScore = (() => {
        const sentenceLength = metrics.averageSentenceLength || (0, nlp_1.averageSentenceLength)(metrics.rawText);
        const target = benchmarks.readability.targetSentenceLength;
        const within = sentenceLength >= target.min && sentenceLength <= target.max;
        if (!within) {
            actionable.push("Break up long sentences to keep average sentence length between 12-24 words.");
        }
        return scoreForRange(sentenceLength, target.min, target.max);
    })();
    const weights = normalizeWeights({
        length: benchmarks.wordCount.avg > 1800 ? 24 : 20,
        keyword: 20,
        nlp: 16 + Math.min(6, (nlpTargetTerms.length || 1) / 4),
        headings: 12,
        meta: 10,
        links: benchmarks.links.external.avg + benchmarks.links.internal.avg > 20 ? 10 : 8,
        media: benchmarks.media.images.avg > 6 ? 10 : 8,
        readability: 6,
    });
    const categories = [
        { id: "length", label: "Content length", score: lengthScore, weight: weights.length, reasons: [] },
        { id: "keyword", label: "Keyword placement", score: keywordPlacementScore, weight: weights.keyword, reasons: [] },
        { id: "nlp", label: "NLP coverage", score: nlpCoverageScore, weight: weights.nlp, reasons: [] },
        { id: "headings", label: "Heading structure", score: headingScore, weight: weights.headings, reasons: [] },
        { id: "meta", label: "Meta optimization", score: metaScore, weight: weights.meta, reasons: [] },
        { id: "links", label: "Link structure", score: linkScore, weight: weights.links, reasons: [] },
        { id: "media", label: "Media usage", score: mediaScore, weight: weights.media, reasons: [] },
        { id: "readability", label: "Readability", score: readabilityScore, weight: weights.readability, reasons: [] },
    ];
    if (lengthScore < 80)
        actionable.push(`Target ${benchmarks.wordCount.min}-${benchmarks.wordCount.max} words to mirror competitors.`);
    if (keywordPlacementScore < 80)
        actionable.push("Work the primary keyword into the title, H1, and early H2s.");
    if (nlpCoverageScore < 80 && nlpMissing.length) {
        actionable.push(`Add missing NLP terms: ${nlpMissing.slice(0, 6).join(", ")}`);
    }
    if (mediaScore < 70)
        actionable.push(`Add ${benchmarks.media.images.min}-${benchmarks.media.images.max} relevant images.`);
    const total = Math.round(categories.reduce((sum, cat) => sum + (cat.score * cat.weight) / 100, 0));
    return {
        total,
        categories,
        missingTerms: Array.from(new Set([...nlpMissing, ...secondaryMissing])),
        overOptimized,
        actionable,
        metrics: {
            wordCount: metrics.wordCount,
            headingCounts: {
                h1: metrics.headings.h1.length,
                h2: metrics.headings.h2.length,
                h3: metrics.headings.h3.length,
            },
            keywordCounts: {
                [primaryKeyword]: primaryFrequency,
                ...keywordCounts,
            },
            imageCount: metrics.imageCount,
            internalLinks: metrics.internalLinks,
            externalLinks: metrics.externalLinks,
            avgSentenceLength: metrics.averageSentenceLength,
        },
    };
}
