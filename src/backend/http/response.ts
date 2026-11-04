/**
 * Connect a Next.js route to one workflow.
 * The browser receives either one JSON result or real progress events followed by
 * a final result. Keep-alive messages only keep the connection open; they do not
 * claim that research has progressed.
 */
import type { Activity } from '../../shared/types.ts';
import type { EmitActivity } from '../providers/exa/types.ts';
import { errorPayload } from '../errors.ts';
import { readRequest } from './request.ts';
export async function researchResponse<T>(request: Request, work: (body: Record<string, unknown>, options: {
  signal: AbortSignal;
  emit?: EmitActivity;
}) => Promise<T>): Promise<Response> {
  // 1. Reject invalid requests before starting a workflow or spending credits.
  let body: Record<string, unknown>;
  try {
    body = await readRequest(request);
  } catch (error) {
    const p = errorPayload(error);
    return Response.json({
      error: p.error,
      code: p.code
    }, {
      status: p.status
    });
  }
  const headers = {
    "Cache-Control": "no-store, no-transform"
  };
  // 2. API callers can request one JSON result instead of a live stream.
  if (!request.headers.get("accept")?.includes("text/event-stream")) {
    try {
      return Response.json(await work(body, {
        signal: request.signal
      }), {
        headers
      });
    } catch (error) {
      const p = errorPayload(error);
      return Response.json({
        error: p.error,
        code: p.code
      }, {
        status: p.status,
        headers
      });
    }
  }
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, request.signal]);
  const encoder = new TextEncoder();
  let canceled = false;
  // 3. The interactive UI receives activities as they happen, then one result.
  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      const send = (event: string, data: unknown) => {
        if (!canceled) streamController.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const heartbeat = setInterval(() => {
        if (!canceled) streamController.enqueue(encoder.encode(": keep-alive\n\n"));
      }, 15_000);
      void (async () => {
        try {
          const result = await work(body, {
            signal,
            emit: activity => send("activity", activity)
          });
          send("activity", {
            id: "validation",
            origin: "app",
            at: Date.now(),
            label: "Results ready",
            detail: "Checked the result format and applied this step's constraints.",
            state: "complete"
          } satisfies Activity);
          send("complete", result);
        } catch (error) {
          const p = errorPayload(error);
          send("error", {
            error: p.error,
            code: p.code
          });
        } finally {
          clearInterval(heartbeat);
          if (!canceled) streamController.close();
        }
      })();
    },
    cancel() {
      canceled = true;
      controller.abort();
    }
  });
  return new Response(stream, {
    headers: {
      ...headers,
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no"
    }
  });
}
