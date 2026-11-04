/**
 * Turn Exa's HTTP response into the data our application understands.
 * Read either JSON or the final SSE result, then preserve generated content,
 * field citations and bounded page excerpts. None of this verifies claim meaning.
 */
import { citations, grounding, record, safeUrl } from "../../../shared/validation.ts";
import { AppError } from "../../errors.ts";
import { MAX_RESPONSE_BYTES } from "./limits.ts";
import { consumeExaStream } from "./stream.ts";
import type { EmitActivity, SourcePage } from "./types.ts";

/** Keep useful page context without allowing unsafe URLs or unbounded text. */
export function readSourcePages(value: unknown): SourcePage[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const clean = (value: unknown, max: number) => typeof value === "string" ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max) : "";
  return value.slice(0, 100).flatMap(item => {
    const entry = record(item);
    const url = safeUrl(entry.url);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{
      url,
      title: clean(entry.title, 400) || new URL(url).hostname,
      text: clean(entry.text, 12_000),
      highlights: Array.isArray(entry.highlights) ? entry.highlights.slice(0, 5).map(value => clean(value, 2000)).filter(Boolean) : []
    }];
  }).slice(0, 10);
}
export async function readDeepResponse(response: Response, emit: EmitActivity) {
  const streamed = Boolean(response.headers.get("content-type")?.includes("text/event-stream") && response.body);
  if (streamed && response.body) return {
    raw: await consumeExaStream(response.body, emit),
    streamed
  };
  const rawText = await response.text();
  if (rawText.length > MAX_RESPONSE_BYTES) throw new AppError("Deep returned too much data.", 502, "RESPONSE_TOO_LARGE");
  let raw: Record<string, unknown>;
  try {
    raw = record(JSON.parse(rawText));
  } catch {
    throw new AppError("Exa returned unreadable data. Please retry this step.", 502, "INVALID_DEEP_RESPONSE");
  }
  emit({
    id: "synthesis",
    origin: "exa",
    eventType: "response",
    label: "Structured findings received",
    detail: "Exa returned its completed research response.",
    state: "complete"
  });
  return {
    raw,
    streamed
  };
}
export function parseDeepOutput(raw: Record<string, unknown>) {
  const output = record(raw.output);
  let content = record(output.content);
  if (typeof output.content === "string") {
    try {
      content = record(JSON.parse(output.content));
    } catch {/* Check the result below. */}
  }
  if (!Object.keys(content).length) throw new AppError("Deep returned no structured findings. Add a profile link or more detail and try again.", 502, "EMPTY_DEEP_RESPONSE");
  const fields = grounding(output.grounding);
  // Grounding may cite useful pages that are absent from the selected results.
  const sources = citations([...fields.flatMap(g => g.citations), ...(Array.isArray(raw.results) ? raw.results : [])]);
  return {
    content,
    grounding: fields,
    sources,
    sourcePages: readSourcePages(raw.results)
  };
}
