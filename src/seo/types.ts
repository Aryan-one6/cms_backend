export type SerpQuery = {
  keyword: string;
  location: string;
  language: string;
  num?: number;
};

export type OrganicResult = {
  title: string;
  url: string;
  snippet?: string;
  position: number;
  source?: string;
};

export type TermStat = { term: string; score: number };

export type TermRecommendation = {
  term: string;
  recommended: number;
  avg: number;
  min: number;
  max: number;
};

export type HeadingStructure = {
  h1: string[];
  h2: string[];
  h3: string[];
  h4: string[];
  h5: string[];
  h6: string[];
};

export type SchemaPresence = {
  faq: boolean;
  article: boolean;
  rawTypes: string[];
};

export type DocumentMetrics = {
  url?: string;
  title?: string;
  snippet?: string;
  position?: number;
  wordCount: number;
  titleLength: number;
  metaDescriptionLength: number;
  headings: HeadingStructure;
  keywordFrequency: Record<string, number>;
  nlpFrequency: Record<string, number>;
  internalLinks: number;
  externalLinks: number;
  imageCount: number;
  schema: SchemaPresence;
  rawText: string;
  averageSentenceLength: number;
};

export type CompetitorSnapshot = DocumentMetrics & {
  url: string;
  title: string;
  position: number;
  domain: string;
};

export type NlpExtraction = {
  topTerms: TermStat[]; // now biased toward multi-word/long-tail phrases when available
  semanticPhrases: TermStat[];
  questions: string[];
};

export type Benchmarks = {
  wordCount: { min: number; max: number; avg: number };
  headingTargets: { h1: number; h2: number; h3: number };
  keyword: {
    primary: { min: number; max: number; avg: number };
    secondary: TermRecommendation[];
  };
  nlpTerms: TermRecommendation[];
  links: {
    internal: { min: number; max: number; avg: number };
    external: { min: number; max: number; avg: number };
  };
  media: { images: { min: number; max: number; avg: number } };
  readability: { avgSentenceLength: number; targetSentenceLength: { min: number; max: number } };
};

export type ScoreCategory = {
  id: string;
  label: string;
  score: number;
  weight: number;
  reasons: string[];
};

export type ContentMetricSnapshot = {
  wordCount: number;
  headingCounts: { h1: number; h2: number; h3: number };
  keywordCounts: Record<string, number>;
  imageCount: number;
  internalLinks: number;
  externalLinks: number;
  avgSentenceLength: number;
};

export type ContentScore = {
  total: number;
  categories: ScoreCategory[];
  missingTerms: string[];
  overOptimized: string[];
  actionable: string[];
  metrics: ContentMetricSnapshot;
};

export type SeoSuggestionPayload = {
  headings: string[];
  faqs: string[];
  paragraphSuggestions: string[];
  missingTerms: string[];
};
