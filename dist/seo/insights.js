"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractNlpSignals = extractNlpSignals;
const nlp_1 = require("./nlp");
function extractNlpSignals(competitors) {
    const corpus = competitors.map((c) => c.rawText || "").join(" ");
    const tokens = (0, nlp_1.tokenize)(corpus);
    const questions = competitors
        .flatMap((c) => (0, nlp_1.extractQuestionPhrases)(c.rawText || ""))
        .concat((0, nlp_1.extractQuestionPhrases)(corpus));
    const semanticTwo = (0, nlp_1.topPhrases)(tokens, 2, 30);
    const semanticThree = (0, nlp_1.topPhrases)(tokens, 3, 20);
    const dedupedQuestions = Array.from(new Set(questions.map((q) => q.toLowerCase().trim()))).slice(0, 20);
    const phraseCandidates = [...semanticThree, ...semanticTwo].filter((p) => {
        const clean = (p.term || "").trim();
        // Prefer longer tail phrases with at least one space and 8+ chars
        return clean.length >= 8 && clean.includes(" ");
    });
    const longTailTerms = phraseCandidates.length > 12
        ? phraseCandidates.slice(0, 12)
        : phraseCandidates;
    const wordTerms = (0, nlp_1.topTerms)(tokens, 40).filter((t) => (t.term || "").length >= 5).slice(0, 12);
    return {
        topTerms: longTailTerms.length ? longTailTerms : wordTerms,
        semanticPhrases: phraseCandidates.slice(0, 25),
        questions: dedupedQuestions,
    };
}
