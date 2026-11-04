/**
 * The two response shapes used to discover and qualify jobs.
 * Schemas describe returned data; the qualification code still checks evidence and sources.
 */
import type { DeepSchema } from "../../providers/exa/deep.ts";
const string = {
  type: "string"
};
const stringArray = {
  type: "array",
  items: string
};
export const opportunitiesSchema: DeepSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    jobs: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          company: string,
          title: string,
          location: string,
          url: string,
          whyMatch: string,
          evidenceIds: stringArray,
          requirements: stringArray,
          gaps: stringArray,
          status: {
            type: "string",
            enum: ["open", "uncertain", "closed"]
          }
        },
        required: ["company", "title", "location", "url", "whyMatch", "evidenceIds", "requirements", "gaps", "status"]
      }
    }
  },
  required: ["jobs"]
};
export const qualificationSchema: DeepSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    // A flat table avoids nesting requirement objects inside job objects.
    // Nine total properties; repeat the posting identity on every criterion.
    criteria: {
      type: "array",
      maxItems: 120,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          jobId: {
            type: "string"
          },
          postingUrl: {
            type: "string"
          },
          postingStatus: {
            type: "string",
            enum: ["open", "closed", "unavailable"]
          },
          requirement: string,
          importance: { type: "string", enum: ["core", "required", "preferred"] },
          evidenceIds: stringArray,
          support: { type: "string", enum: ["direct", "transferable", "missing"] },
          reason: string
        },
        required: ["jobId", "postingUrl", "postingStatus", "requirement", "importance", "evidenceIds", "support", "reason"]
      }
    }
  },
  required: ["criteria"]
};
