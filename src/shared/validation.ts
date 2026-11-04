/**
 * Small, deterministic data helpers shared across the application.
 * Input: untrusted values or existing profile data. Output: normalized values.
 * Nothing here reads secrets, performs network requests, or uses browser storage.
 * Server-side request rejection lives in backend/validation.ts.
 */
import type { Citation, Evidence, Grounding, Profile } from "./types.ts";

/** A malformed object becomes an empty record, so callers can check fields safely. */
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function strings(value: unknown, maxItems = 30, maxLength = 1000): string[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).filter((x): x is string => typeof x === "string").map(x => x.trim().slice(0, maxLength)).filter(Boolean);
}

/** Only public web links are allowed in rendered citations and job actions. */
export function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4000) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".localhost") || host.endsWith(".internal")) return null;
    if (host.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
    return url.href;
  } catch {
    return null;
  }
}
export function citations(value: unknown): Citation[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.slice(0, 100).flatMap(item => {
    const entry = record(item);
    const url = safeUrl(entry.url);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{
      url,
      title: typeof entry.title === "string" ? entry.title.slice(0, 400) : new URL(url).hostname
    }];
  });
}

/** Exa may spell the same field as evidence[0].claim or /evidence/0/claim. */
export function normalizeField(field: string): string {
  return field.replace(/^\$\.?/, "").replace(/^output\.content\./, "").replace(/^content\./, "").replace(/^\//, "").replace(/\/(\d+)(?=\/|$)/g, "[$1]").replace(/\//g, ".").replace(/\.(\d+)(?=\.|$)/g, "[$1]");
}
export function grounding(value: unknown): Grounding[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 500).flatMap(item => {
    const entry = record(item);
    if (typeof entry.field !== "string") return [];
    const confidence = ["low", "medium", "high"].includes(String(entry.confidence)) ? entry.confidence as Grounding["confidence"] : undefined;
    return [{
      field: normalizeField(entry.field),
      citations: citations(entry.citations),
      confidence
    }];
  });
}

/** Collect evidence attached to this field or any of its children. */
export function citationsFor(items: Grounding[], field: string): Citation[] {
  const normalized = normalizeField(field);
  return citations(items.filter(item => item.field === normalized || item.field.startsWith(`${normalized}.`) || item.field.startsWith(`${normalized}[`)).flatMap(item => item.citations));
}

/** Normalize known legal-name variations without equating every similar name. */
export function normalizeEmployer(company: string): string {
  let normalized = company.normalize("NFKC").toLowerCase().replace(/&/g, " and ").replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim().replace(/^the /, "");
  normalized = normalized.replace(/(?:\s+(?:incorporated|inc|corporation|corp|limited|ltd|llc|plc|gmbh|co))+$/, "").trim();
  const aliases: Record<string, string> = {
    "zoom video communications": "zoom",
    "zoom communications": "zoom",
    "meta platforms": "meta",
    "facebook": "meta",
    "google llc": "google"
  };
  return aliases[normalized] ?? normalized;
}
export function isExcluded(company: string, excluded: string[]): boolean {
  const normalized = normalizeEmployer(company);
  return !!normalized && excluded.some(item => normalizeEmployer(item) === normalized);
}
/** The legacy confirmed flag records inclusion; it does not certify a claim's truth. */
export function selectedEvidence(profile: Profile): Evidence[] {
  return profile.evidence.filter(item => item.confirmed === true && !!item.claim.trim());
}

/** Build the selected claims for a research prompt, with a bounded excerpt budget. */
export function candidateContext(profile: Profile) {
  // Deselected claims stay out of job matching and drafting. Source support still needs assessment.
  let remainingExcerptChars = 16000;
  return {
    name: profile.name,
    evidence: selectedEvidence(profile).map(({
      id,
      claim,
      sources,
      sourceExcerpts,
      confidence
    }) => ({
      id,
      claim,
      sources,
      confidence,
      sourceExcerpts: (sourceExcerpts ?? []).flatMap(excerpt => {
        const excerptText = excerpt.text.slice(0, Math.min(1000, remainingExcerptChars));
        remainingExcerptChars -= excerptText.length;
        return excerptText ? [{
          url: excerpt.url,
          text: excerptText
        }] : [];
      })
    }))
  };
}

/** Catch invented numeric claims; the separate Deep review checks meaning too. */
export function hasUnsupportedNumbers(candidate: string, evidence: string): boolean {
  const numbers = (s: string) => s.match(/\b\d[\d,.]*(?:%|\+)?/g)?.map(x => x.replace(/,/g, "")) ?? [];
  const allowed = new Set(numbers(evidence));
  return numbers(candidate).some(number => !allowed.has(number));
}
