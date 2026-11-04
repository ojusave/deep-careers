/**
 * The data shapes requested for resume drafting and its independent review.
 * Each draft bullet connects to an existing evidence ID and assessed requirement IDs.
 */
import type { DeepSchema } from "../../providers/exa/deep.ts";
const string = {
  type: "string"
};
const stringArray = {
  type: "array",
  items: string
};
export const roleSchema: DeepSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: string,
    priorities: stringArray,
    bullets: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          evidenceId: string,
          text: string,
          employerIndex: {
            type: "integer",
            minimum: -1
          },
          requirementIds: stringArray
        },
        required: ["evidenceId", "text", "employerIndex", "requirementIds"]
      }
    },
    gaps: stringArray,
    changes: stringArray,
    skills: stringArray
  },
  required: ["summary", "priorities", "bullets", "gaps", "changes", "skills"]
};
export const draftReviewSchema: DeepSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    checks: {
      type: "array",
      maxItems: 65,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          target: {
            type: "string"
          },
          supported: {
            type: "boolean"
          },
          relevant: {
            type: "boolean"
          },
          employerSupported: {
            type: "boolean"
          },
          reason: {
            type: "string"
          }
        },
        required: ["target", "supported", "relevant", "employerSupported", "reason"]
      }
    }
  },
  required: ["checks"]
};
