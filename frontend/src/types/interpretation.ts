export interface BidProject {
  id: string;
  project_name?: string | null;
  project_no?: string | null;
  tender_unit?: string | null;
  agency?: string | null;
  project_type?: string | null;
  status?: string | null;
  created_at?: string | null;
}

export interface BidAnalysis {
  id: string;
  project_id: string;
  project_meta?: Record<string, unknown> | null;
  qualification_requirements?: unknown[] | null;
  document_checklist?: unknown[] | null;
  scoring_items?: unknown[] | null;
  risk_items?: unknown[] | null;
  chapter_suggestions?: unknown[] | null;
  summary?: string | null;
}

export interface RequirementItem {
  id: string;
  requirement_type?: string | null;
  title?: string | null;
  content?: string | null;
  priority?: string | null;
  source_section?: string | null;
  source_page?: number | null;
}

export interface RiskItem {
  id: string;
  risk_level?: string | null;
  risk_type?: string | null;
  content?: string | null;
  action?: string | null;
  source_section?: string | null;
  source_page?: number | null;
}

export interface ScoringItem {
  id: string;
  category?: string | null;
  item?: string | null;
  score?: number | null;
  requirement?: string | null;
  response_suggestion?: string | null;
  target_chapter?: string | null;
  source_section?: string | null;
  source_page?: number | null;
}

export interface ChapterSuggestion {
  id: string;
  chapter_title?: string | null;
  reason?: string | null;
  priority?: string | null;
}

export interface DocumentChunk {
  id: string;
  chunk_index: number;
  content: string;
  source_page?: number | null;
  source_section?: string | null;
}

export interface InterpretationResponse {
  project: BidProject | null;
  analysis: BidAnalysis | null;
  requirements: RequirementItem[];
  risks: RiskItem[];
  scoringItems: ScoringItem[];
  chapterSuggestions: ChapterSuggestion[];
  documentChunks: DocumentChunk[];
}
