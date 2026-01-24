import { extractQuestionPhrases, tokenize, topPhrases, topTerms } from "./nlp";
import { CompetitorSnapshot, NlpExtraction } from "./types";

export function extractNlpSignals(competitors: CompetitorSnapshot[]): NlpExtraction {
  const corpus = competitors.map((c) => c.rawText || "").join(" ");
  const tokens = tokenize(corpus);

  const questions = competitors
    .flatMap((c) => extractQuestionPhrases(c.rawText || ""))
    .concat(extractQuestionPhrases(corpus));

  const semanticTwo = topPhrases(tokens, 2, 30);
  const semanticThree = topPhrases(tokens, 3, 20);

  const dedupedQuestions = Array.from(new Set(questions.map((q) => q.toLowerCase().trim()))).slice(0, 20);

  const phraseCandidates = [...semanticThree, ...semanticTwo].filter((p) => {
    const clean = (p.term || "").trim();
    // Prefer longer tail phrases with at least one space and 8+ chars
    return clean.length >= 8 && clean.includes(" ");
  });

  const longTailTerms =
    phraseCandidates.length > 12
      ? phraseCandidates.slice(0, 12)
      : phraseCandidates;

  const wordTerms = topTerms(tokens, 40).filter((t) => (t.term || "").length >= 5).slice(0, 12);

  return {
    topTerms: longTailTerms.length ? longTailTerms : wordTerms,
    semanticPhrases: phraseCandidates.slice(0, 25),
    questions: dedupedQuestions,
  };
}
