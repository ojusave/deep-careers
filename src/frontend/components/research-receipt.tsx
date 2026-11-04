/**
 * Displays the actual metadata returned for one completed Deep request.
 * Missing cost or request IDs remain missing; the UI does not estimate them.
 */
import type { Receipt } from "@/shared/types";
export function ResearchReceipt({
  receipt,
  label = "Request details"
}: {
  receipt: Receipt;
  label?: string;
}) {
  return <details className="receipt">
    <summary>
      {label}
    </summary>
    <dl>
      <div>
        <dt>Mode</dt>
        <dd>Exa Deep</dd>
      </div>
      <div>
        <dt>Sources</dt>
        <dd>
          {receipt.sourceCount}
        </dd>
      </div>
      <div>
        <dt>Time</dt>
        <dd>{(receipt.elapsedMs / 1000).toFixed(1)}s</dd>
      </div>
      {typeof receipt.costDollars === "number" && <div>
        <dt>Cost</dt>
        <dd>${receipt.costDollars.toFixed(3)}</dd>
      </div>}
      <div className="receipt-id">
        <dt>Request</dt>
        <dd>
          {receipt.requestId || "Not returned"}
        </dd>
      </div>
    </dl>
  </details>;
}
