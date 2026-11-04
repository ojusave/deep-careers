/**
 * The contract between application workflows and the Exa provider adapter.
 * A task describes what to research; a response contains findings and their sources.
 * Source-page text is untrusted context, not proof that every generated claim is true.
 */
import type { Activity, Citation, Grounding, Receipt } from '../../../shared/types.ts';
export type DeepSchema = Record<string, unknown>;
export type EmitActivity = (activity: Activity) => void;
export type SourcePage = {
  url: string;
  title: string;
  text: string;
  highlights: string[];
};
export type DeepResponse = {
  content: Record<string, unknown>;
  grounding: Grounding[];
  sources: Citation[];
  receipt: Receipt;
  sourcePages?: SourcePage[];
};
export type DeepTask = {
  stage: Receipt["stage"];
  query: string;
  systemPrompt: string;
  outputSchema: DeepSchema;
  additionalQueries?: string[];
  fullText?: boolean;
};
