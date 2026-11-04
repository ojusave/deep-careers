/**
 * The server's single entry point for Exa Deep.
 * Workflows supply a research task; this file adds the API key, applies limits,
 * sends the request and returns parsed findings with an actual research receipt.
 * Only backend modules may import this file: credentials never go to the browser.
 */
import type { Receipt } from "../../../shared/types.ts";
import { citations, record } from "../../../shared/validation.ts";
import { AppError } from "../../errors.ts";
import { acquireDeepSlot, assertDeepBudgetAvailable, recordDeepAttempt, DEEP_TIMEOUT_MS } from "./limits.ts";
import { MAX_DEEP_ATTEMPTS, retryDelayMs, waitForRetry } from "./retry.ts";
import { parseDeepOutput, readDeepResponse } from "./response.ts";
import { validateDeepOutputSchema } from "./schema.ts";
import type { DeepResponse, DeepTask, EmitActivity } from "./types.ts";
export type { DeepResponse, DeepSchema, DeepTask, EmitActivity, SourcePage } from "./types.ts";
const stageNames: Record<Receipt["stage"], string> = {
  candidate: "Researching your professional background",
  opportunities: "Researching relevant opportunities",
  role: "Researching this role and its context"
};

/** Build the provider payload. numResults limits returned pages, not internal searches. */
export function buildDeepRequest(task: DeepTask, stream = false) {
  validateDeepOutputSchema(task.outputSchema);
  const additionalQueries = [...new Set((task.additionalQueries ?? []).map(query => query.trim()).filter(Boolean))].slice(0, 10);
  return {
    query: task.query,
    type: "deep" as const,
    numResults: 10,
    systemPrompt: task.systemPrompt,
    outputSchema: task.outputSchema,
    contents: {
      highlights: true,
      ...(task.fullText ? {
        text: {
          maxCharacters: 12_000
        }
      } : {})
    },
    ...(additionalQueries.length ? {
      additionalQueries
    } : {}),
    ...(stream ? {
      stream: true
    } : {})
  };
}
export async function runDeep(task: DeepTask, options: {
  signal?: AbortSignal;
  emit?: EmitActivity;
} = {}): Promise<DeepResponse> {
  // Validate before consuming a quota slot or announcing a provider request.
  // A local schema error must never look like research that actually reached Exa.
  const request = buildDeepRequest(task, !!options.emit);
  const key = process.env.EXA_API_KEY?.trim();
  if (!key) throw new AppError("Add EXA_API_KEY to the server's .env.local file, then restart the app.", 503, "EXA_NOT_CONFIGURED");
  if (options.signal?.aborted) throw new AppError("Research was canceled.", 499, "CANCELED");
  const release = acquireDeepSlot();
  const start = Date.now();
  const timeout = AbortSignal.timeout(DEEP_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const emit: EmitActivity = activity => options.emit?.({
    ...activity,
    origin: activity.origin ?? "app",
    at: Date.now()
  });
  try {
    let response: Response;
    for (let attempt = 1; ; attempt++) {
      signal.throwIfAborted();
      // Check before announcing provider work. A closed stream or cancellation
      // during this callback must not consume an HTTP attempt.
      assertDeepBudgetAvailable();
      if (attempt === 1) emit({
        id: "request",
        label: "Awaiting Exa",
        detail: `${stageNames[task.stage]}. A live request is being sent with type: deep.`,
        state: "running"
      });
      signal.throwIfAborted();
      // Every actual HTTP attempt uses the hourly budget, including 429 retries.
      recordDeepAttempt();
      response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key
      },
      body: JSON.stringify(request),
      cache: "no-store",
      signal
      });
      if (response.status !== 429 || attempt >= MAX_DEEP_ATTEMPTS) break;
      const delay = retryDelayMs(response.headers.get("retry-after"), attempt);
      await response.body?.cancel();
      emit({
        id: "rate-limit-retry",
        origin: "app",
        label: "Exa rate limit received",
        detail: `Retrying in ${Math.ceil(delay / 1000)}s`,
        state: "complete"
      });
      // This wait shares the original timeout and cancellation signal.
      await waitForRetry(delay, signal);
    }
    if (!response.ok) {
      // Never relay provider error bodies: they may contain internal details.
      await response.body?.cancel();
      if ([401, 403].includes(response.status)) throw new AppError("Exa rejected the server's API credentials. Check EXA_API_KEY.", 503, "EXA_AUTH_ERROR");
      if (response.status === 402) throw new AppError("The Exa account needs credits or has reached its spending limit.", 503, "EXA_CREDITS_REQUIRED");
      if (response.status === 429) throw new AppError("Exa's request limit was reached. Please try again shortly.", 429, "EXA_RATE_LIMIT");
      if (response.status === 400) throw new AppError("Exa rejected the research request. Check the server integration and try again.", 502, "EXA_REQUEST_ERROR");
      throw new AppError("Exa is temporarily unavailable. Please retry this step.", 502, "EXA_UNAVAILABLE");
    }
    const {
      raw,
      streamed
    } = await readDeepResponse(response, emit);
    const findings = parseDeepOutput(raw);
    emit({
      id: "grounding",
      origin: "exa",
      eventType: streamed ? "done" : "response",
      label: findings.grounding.length ? "Final field citations received" : "No field citations returned",
      detail: `${findings.grounding.length} grounded fields in the completed response`,
      state: "complete",
      sources: citations(findings.grounding.flatMap(field => field.citations))
    });
    const cost = record(raw.costDollars).total;
    const requestId = typeof raw.requestId === "string" ? raw.requestId : response.headers.get("x-request-id") ?? "";
    emit({
      id: "request",
      label: "Exa Deep request completed",
      detail: requestId ? `Request ${requestId}` : "Completed live Exa Deep request",
      state: "complete"
    });
    return {
      ...findings,
      receipt: {
        stage: task.stage,
        type: "deep",
        requestId,
        elapsedMs: Date.now() - start,
        ...(typeof cost === "number" && Number.isFinite(cost) ? {
          costDollars: cost
        } : {}),
        sourceCount: findings.sources.length,
        retrievedAt: new Date().toISOString()
      }
    };
  } catch (error) {
    emit({
      id: "request",
      label: options.signal?.aborted ? "Research canceled" : "Exa request failed",
      state: "failed",
      detail: error instanceof AppError ? error.message : timeout.aborted ? "The request timed out." : options.signal?.aborted ? "The request was canceled." : "The research request did not complete."
    });
    if (error instanceof AppError) throw error;
    if (timeout.aborted) throw new AppError("Deep took longer than 150 seconds. Your existing work is unchanged; please retry.", 504, "EXA_TIMEOUT");
    if (options.signal?.aborted) throw new AppError("Research was canceled.", 499, "CANCELED");
    throw new AppError("Could not reach Exa. Check the server's internet connection and try again.", 502, "EXA_CONNECTION_ERROR");
  } finally {
    // Free the concurrency slot after success, failure or cancellation.
    release();
  }
}
