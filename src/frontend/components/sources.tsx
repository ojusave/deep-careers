/**
 * Shows the public pages attached to a finding.
 * Invalid links and duplicate URLs are omitted before rendering.
 */
import { safeHref } from "@/frontend/browser/research-stream";
import type { Citation } from "@/shared/types";
function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Source";
  }
}
export function Sources({
  sources,
  label
}: {
  sources: Citation[];
  label?: string;
}) {
  const unique = sources.filter((source, index, all) => safeHref(source.url) && all.findIndex(item => item.url === source.url) === index);
  if (!unique.length) return null;
  return <details className="sources">
    <summary>
      {label || `${unique.length} source${unique.length === 1 ? "" : "s"}`}
    </summary>
    <ul>
      {unique.map(source => <li key={source.url}>
        <a
          href={safeHref(source.url)}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span>
            {source.title || host(source.url)}
          </span>
          <small>{host(source.url)} ↗</small>
        </a>
      </li>)}
    </ul>
  </details>;
}
