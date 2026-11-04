/**
 * The browser calls our API routes through this file.
 * Input: a route, request data and a cancellation signal.
 * Output: live activity callbacks followed by the completed result.
 * The Exa key and provider connection stay on the backend.
 */
import type { Activity } from "../../shared/types.ts";
export type ServerEvent = {
  event: string;
  data: string;
};

/** Incremental SSE parsing: one event can span network chunks and data lines. */
export function createEventParser(onEvent: (event: ServerEvent) => void) {
  let buffer = "";
  function dispatch(block: string) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      const index = line.indexOf(":");
      const field = index < 0 ? line : line.slice(0, index);
      const value = index < 0 ? "" : line.slice(index + 1).replace(/^ /, "");
      if (field === "event") event = value;
      if (field === "data") data.push(value);
    }
    if (data.length) onEvent({
      event,
      data: data.join("\n")
    });
  }
  return {
    push(chunk: string) {
      buffer = (buffer + chunk).replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        dispatch(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
      }
    },
    finish() {
      if (buffer.trim()) dispatch(buffer.replace(/\r/g, ""));
      buffer = "";
    }
  };
}
export async function researchRequest<T>(path: string, payload: unknown, signal: AbortSignal, onActivity: (item: Activity) => void): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream"
    },
    body: JSON.stringify(payload),
    signal
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(error?.error || `Research could not finish (HTTP ${response.status}). Please try again.`);
  }
  if (!response.headers.get("content-type")?.includes("text/event-stream")) return response.json() as Promise<T>;
  if (!response.body) throw new Error("No research stream was returned. Please try again.");
  let result: T | undefined;
  let completed = false;
  let failure: Error | undefined;
  const parser = createEventParser(({
    event,
    data
  }) => {
    if (data === "[DONE]") return;
    let value: unknown;
    try {
      value = JSON.parse(data);
    } catch {
      throw new Error("The research stream was interrupted. Please try again.");
    }
    if (event === "activity" && value && typeof value === "object" && "label" in value
      && typeof value.label === "string") onActivity(value as Activity);
    if (event === "complete") {
      result = value as T;
      completed = true;
    }
    if (event === "error") {
      const message = value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : "Research could not finish. Please try again.";
      failure = new Error(message);
    }
  });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const {
        value,
        done
      } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, {
        stream: true
      }));
      if (failure) throw failure;
    }
    parser.push(decoder.decode());
    parser.finish();
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (failure) throw failure;
  if (!completed) throw new Error("Research ended before a complete result arrived. Your existing work is unchanged.");
  return result as T;
}
export function safeHref(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
