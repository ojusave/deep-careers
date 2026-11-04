/**
 * Renders events received from our backend, including their App or Exa origin.
 * This is request progress, not a reconstruction of private model reasoning.
 * Only final application validation marks the entire workflow complete.
 */
import { safeHref } from "@/frontend/browser/research-stream";
import type { Activity, Citation } from "@/shared/types";
function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Source";
  }
}
function activePhases(events: Activity[]) {
  const byScope = new Map<string, Activity>();
  for (const event of events) {
    const scope = event.scope || "legacy";
    if (event.state === "running") byScope.set(scope, event);else if (byScope.get(scope)?.id === event.id || event.eventType === "done" || event.eventType === "error") byScope.delete(scope);
  }
  return [...byScope.values()].sort((a, b) => events.indexOf(b) - events.indexOf(a)).slice(0, 2);
}
function timestamp(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
function ActivitySourceLinks({
  sources
}: {
  sources: Citation[];
}) {
  return <div className="activity-source-row">
    {sources.map(source => <a
      key={source.url}
      href={safeHref(source.url)}
      target="_blank"
      rel="noopener noreferrer"
      title={`${source.title || "Source"} · ${host(source.url)}`}
    >{source.title || host(source.url)} ↗</a>)}
  </div>;
}
export function ActivityFeed({
  events,
  busy,
  elapsed,
  onCancel,
  completionLabel = "Research complete"
}: {
  events: Activity[];
  busy: string | null;
  elapsed: number;
  onCancel: () => void;
  completionLabel?: string;
}) {
  if (!events.length && !busy) return null;
  const phases = activePhases(events);
  const complete = events.some(item => item.id === "validation" && item.state === "complete" && item.origin !== "exa");
  const label = busy ? phases.map(item => item.scope && item.origin === "exa" ? `${item.scope}: ${item.label}` : item.label).join(" · ") || "Researching" : complete ? completionLabel : "Research interrupted";
  const seconds = Math.max(0, Math.floor(elapsed));
  const seenSources = new Set<string>();
  return <section className="activity-region" aria-label="Research activity">
    <details className="activity-details">
      <summary>
        <span className={busy ? "status-dot pulsing" : complete ? "status-dot done" : "status-dot"} />
        <span
          className="activity-current"
          role="status"
          aria-live="polite"
        >
          {label}
        </span>
        <span className="elapsed">{seconds >= 60 ? `${Math.floor(seconds / 60)}m ` : ""}{seconds % 60}s</span>
      </summary>
      <ol>
        {events.map(item => {
          const origin = item.origin === "exa" ? "Exa" : item.origin === "app" ? "App" : "Activity";
          const originTitle = item.origin === "exa" ? "Reported by Exa's API" : item.origin === "app" ? "Application workflow event" : "Event origin was not recorded";
          const status = item.state === "failed" ? "Failed" : item.state === "complete" ? "Complete" : busy ? "In progress" : "Not completed";
          const at = timestamp(item.at);
          const sources = (item.sources || []).filter(source => {
            if (!safeHref(source.url) || seenSources.has(source.url)) return false;
            seenSources.add(source.url);
            return true;
          });
          return <li key={item.id} aria-label={`${origin}: ${item.label} — ${status}`}>
          <span className="activity-symbol" aria-hidden="true">
            {item.state === "failed" ? "!" : item.state === "complete" ? "✓" : busy ? "◌" : "—"}
          </span>
          <div className="activity-event">
            <div className="activity-event-heading">
              <span>
                {item.label}
              </span>
              <span className={`activity-origin${item.origin === "exa" ? " provider" : ""}`} title={originTitle}>
                {origin}
              </span>
            </div>
            {sources.length > 0 && <ActivitySourceLinks sources={sources.slice(0, 3)} />}
            {sources.length > 3 && <details className="activity-more-sources">
              <summary>+{sources.length - 3} sources</summary>
              <ActivitySourceLinks sources={sources.slice(3)} />
            </details>}
            {(item.detail || item.eventType || item.scope || at) && <details className="activity-event-detail">
              <summary>Details</summary>
              {item.detail && <p>
                {item.detail}
              </p>}
              <dl>
                {item.eventType && <div>
                  <dt>Event</dt>
                  <dd>
                    {item.eventType}
                  </dd>
                </div>}
                {item.scope && <div>
                  <dt>Phase</dt>
                  <dd>
                    {item.scope}
                  </dd>
                </div>}
                {at && <div>
                  <dt>Received</dt>
                  <dd>
                    <time dateTime={at}>{at.slice(11, 19)} UTC</time>
                  </dd>
                </div>}
              </dl>
            </details>}
          </div>
        </li>;
        })}
      </ol>
    </details>
    {busy && <button className="text-button" onClick={onCancel}>Stop</button>}
  </section>;
}
