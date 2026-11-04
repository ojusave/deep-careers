/**
 * Read the JSON body of an incoming API request.
 * Check origin, content type and byte limits before a workflow or paid call starts.
 */
import { AppError } from '../errors.ts';
import { record } from '../../shared/validation.ts';

function applicationOrigin(request: Request): string {
  // A proxy can give Next.js an internal URL such as http://0.0.0.0:10000.
  // Compare browser requests with our configured public URL instead. APP_ORIGIN
  // supports a custom domain; Render supplies RENDER_EXTERNAL_URL automatically.
  // Do not trust forwarded host headers, which callers can supply themselves.
  const configured = process.env.APP_ORIGIN?.trim() || process.env.RENDER_EXTERNAL_URL?.trim();
  if (!configured) return new URL(request.url).origin;
  try {
    const url = new URL(configured);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid public URL");
    return url.origin;
  } catch {
    throw new AppError("The server's public URL is not configured correctly.", 503, "INVALID_APP_ORIGIN");
  }
}

export async function readRequest(request: Request): Promise<Record<string, unknown>> {
  const origin = request.headers.get("origin");
  if (origin && origin !== applicationOrigin(request)) throw new AppError("This request must come from this application.", 403, "INVALID_ORIGIN");
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new AppError("Send JSON request data.", 415);
  if (Number(request.headers.get("content-length") ?? 0) > 400_000) throw new AppError("The request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("Request data is missing.");
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const {
      value,
      done
    } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 400_000) {
      await reader.cancel();
      throw new AppError("The request is too large.", 413);
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  try {
    return record(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    throw new AppError("The request contains invalid JSON.");
  }
}
