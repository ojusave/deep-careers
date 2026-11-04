/**
 * The shapes we ask Exa Deep to return for candidate research.
 * Each schema stays within Deep’s ten-property limit, counting nested fields.
 */
import type { DeepSchema } from "../../providers/exa/deep.ts";
const string = {
  type: "string"
};

// Eight properties in total. Identity discovery is deliberately separate from
// career research: a plausible name match does not identify the intended person.
export const identitySchema: DeepSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    resolution: { type: "string", enum: ["resolved", "ambiguous", "insufficient"] },
    question: string,
    candidates: {
      type: "array", maxItems: 3,
      items: {
        type: "object", additionalProperties: false,
        properties: { name: string, headline: string, employer: string, profileUrl: string, matchEvidence: string },
        required: ["name", "headline", "employer", "profileUrl", "matchEvidence"]
      }
    }
  },
  required: ["resolution", "question", "candidates"]
};

export const candidateSchema: DeepSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: string,
    summary: string,
    clarification: string,
    employers: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          company: string,
          role: string,
          period: string,
          status: {
            type: "string",
            enum: ["current", "earlier", "uncertain"]
          }
        },
        required: ["company", "role", "period", "status"]
      }
    },
    evidence: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          claim: string
        },
        required: ["claim"]
      }
    }
  },
  required: ["name", "summary", "clarification", "employers", "evidence"]
};

// Seven properties total, including nested fields. Each request investigates
// one employment entry, including entries that already have some public facts.
export const workEvidenceSchema: DeepSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    findings: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          employerIndex: {
            type: "integer",
            minimum: 0
          },
          claim: string
        },
        required: ["employerIndex", "claim"]
      }
    },
    coverage: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          employerIndex: {
            type: "integer",
            minimum: 0
          },
          note: string,
          outcome: {
            type: "string",
            enum: ["evidence_found", "no_public_detail", "source_unavailable"]
          }
        },
        required: ["employerIndex", "note", "outcome"]
      }
    }
  },
  required: ["findings", "coverage"]
};
