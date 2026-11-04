/**
 * Read the typed server-sent events returned by Exa.
 * Sources and synthesis updates can be displayed live, but only done.output becomes
 * the final result. A reset clears partial citations; a truncated stream fails.
 * Exa does not expose its internal reasoning through these events.
 */
import type { Grounding } from '../../../shared/types.ts';
import { citations, grounding, record } from '../../../shared/validation.ts';
import { AppError } from '../../errors.ts';
import { MAX_RESPONSE_BYTES } from './limits.ts';
import type { EmitActivity } from './types.ts';
export async function consumeExaStream(body: ReadableStream<Uint8Array>, emit: EmitActivity = () => {}) {
  const publish: EmitActivity = activity => emit({
    ...activity,
    origin: "exa",
    at: Date.now()
  });
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  let results: unknown[] = [];
  let final: Record<string, unknown> | null = null;
  let synthesisStarted = false;
  let receivedGrounding: Grounding[] = [];
  const handle = (event: string) => {
    const data = event.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n").trim();
    if (!data || data === "[DONE]") return;
    let payload: Record<string, unknown>;
    try {
      payload = record(JSON.parse(data));
    } catch {
      throw new AppError("Deep returned an unreadable stream. Please retry.", 502, "INVALID_DEEP_RESPONSE");
    }
    switch (payload.type) {
      case "results":
        {
          results = Array.isArray(payload.results) ? payload.results : [];
          const sources = citations(results);
          publish({
            id: "sources",
            eventType: "results",
            label: "Source pages received",
            detail: `${sources.length} source pages returned by Exa`,
            state: "complete",
            sources
          });
          break;
        }
      case "text-delta":
        if (!synthesisStarted) {
          synthesisStarted = true;
          publish({
            id: "synthesis",
            eventType: "text-delta",
            label: "Receiving structured findings",
            detail: "Exa has started streaming its synthesized response.",
            state: "running"
          });
        }
        break;
      case "grounding":
        {
          receivedGrounding = grounding(payload.grounding);
          const sources = citations(receivedGrounding.flatMap(g => g.citations));
          publish({
            id: "grounding",
            eventType: "grounding",
            label: "Field citations received",
            detail: `${receivedGrounding.length} grounded fields in this update`,
            state: "complete",
            sources
          });
          break;
        }
      case "stream-reset":
        receivedGrounding = [];
        synthesisStarted = false;
        publish({
          id: "grounding",
          eventType: "stream-reset",
          label: "Waiting for replacement citations",
          detail: "Exa restarted synthesis. Earlier partial citations were cleared.",
          state: "running",
          sources: []
        });
        publish({
          id: "synthesis",
          eventType: "stream-reset",
          label: "Exa restarted its response",
          detail: "Waiting for the replacement structured result.",
          state: "running"
        });
        break;
      case "done":
        final = {
          ...payload,
          results: Array.isArray(payload.results) ? payload.results : results
        };
        publish({
          id: "synthesis",
          eventType: "done",
          label: "Structured findings received",
          detail: "Exa completed the response; checking the final data now.",
          state: "complete"
        });
        break;
      case "error":
        publish({
          id: "provider-error",
          eventType: "error",
          label: "Exa reported an error",
          detail: "Exa returned an error event before completing this response.",
          state: "failed"
        });
        throw new AppError("Exa could not complete this research. Please try again.", 502, "EXA_STREAM_ERROR");
    }
  };
  try {
    while (true) {
      const {
        done,
        value
      } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new AppError("Deep returned more data than this MVP can process.", 502, "RESPONSE_TOO_LARGE");
      buffer += decoder.decode(value, {
        stream: true
      });
      let boundary: RegExpExecArray | null;
      while (boundary = /\r?\n\r?\n/.exec(buffer)) {
        handle(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) handle(buffer);
    if (!final || !record(final).output) throw new AppError("The Deep stream ended before a complete result arrived. Please retry.", 502, "INCOMPLETE_DEEP_RESPONSE");
    return final as Record<string, unknown>;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
