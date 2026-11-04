/**
 * Small decorative arrow reused on action buttons. The button text carries the accessible meaning.
 */
export function Arrow({
  diagonal = false
}: {
  diagonal?: boolean;
}) {
  return <span aria-hidden="true">
    {diagonal ? "↗" : "→"}
  </span>;
}
