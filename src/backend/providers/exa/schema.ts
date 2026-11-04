/**
 * Catch unsupported output shapes before an Exa request is sent.
 * These are the documented Deep limits, not a general JSON Schema validator:
 * https://exa.ai/docs/search/deep-search#output-schema-limits
 * The documented companies[] example permits root + one item object; another
 * object inside that item is too deep. Arrays themselves add no object level.
 */
import { AppError } from "../../errors.ts";
import type { DeepSchema } from "./types.ts";

const MAX_PROPERTIES = 10;
const MAX_OBJECT_LEVELS = 2;

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function invalid(detail: string): never {
  throw new AppError(`The Exa Deep output schema is invalid: ${detail} No request was sent.`, 500, "INVALID_DEEP_SCHEMA");
}

export function validateDeepOutputSchema(schema: DeepSchema): void {
  if (schema.type !== "object" && schema.type !== "text") invalid('the root type must be "object" or "text".');
  if (schema.type === "text") return;
  let properties = 0;
  const ancestors = new Set<unknown>();

  function visit(value: unknown, path: string, parentObjectLevels: number): void {
    if (!object(value)) return;
    if (ancestors.has(value)) invalid(`${path} contains a circular schema reference.`);
    ancestors.add(value);
    const hasType = (type: string) => value.type === type || Array.isArray(value.type) && value.type.includes(type);
    const isObject = hasType("object") || object(value.properties);
    const objectLevels = parentObjectLevels + Number(isObject);
    if (objectLevels > MAX_OBJECT_LEVELS) invalid(`${path} exceeds 2 object levels, counting the root; flatten nested objects or array items.`);
    if (hasType("array") && (value.items === undefined || value.items === null)) invalid(`${path} is an array without an items schema.`);
    if (object(value.properties)) {
      properties += Object.keys(value.properties).length;
      if (properties > MAX_PROPERTIES) invalid(`it has more than 10 total properties (including nested objects and array items).`);
      for (const [name, child] of Object.entries(value.properties)) visit(child, `${path}.properties.${name}`, objectLevels);
    }
    // Primitive arrays are valid even inside the second object level. An array
    // whose items are objects must still respect the same object-depth bound.
    if (Array.isArray(value.items)) value.items.forEach((child, index) => visit(child, `${path}.items[${index}]`, objectLevels));
    else visit(value.items, `${path}.items`, objectLevels);
    ancestors.delete(value);
  }

  visit(schema, "outputSchema", 0);
}
