/**
 * First screen: collect enough identifying information to start workflow 01.
 * It renders data and sends user actions upward; it never calls Exa directly.
 */
import { useEffect, useRef, type RefObject } from "react";
import type { Activity, IdentityResolution } from "@/shared/types";
import { ActivityFeed } from "@/frontend/components/activity-feed";
import { Arrow } from "@/frontend/components/arrow";
import { IdentityStep } from "@/frontend/features/candidate/identity-step";
type StartScreenProps = {
  input: string;
  busy: string | null;
  configured: boolean | null;
  heading: RefObject<HTMLHeadingElement | null>;
  events: Activity[];
  elapsed: number;
  identity: IdentityResolution | null;
  onInputChange: (value: string) => void;
  onResearch: (input: string) => void;
  onCancel: () => void;
  onConfirm: (candidateId: string) => void;
  onEditIdentity: () => void;
};
export function StartScreen({
  input,
  busy,
  configured,
  heading,
  events,
  elapsed,
  identity,
  onInputChange,
  onResearch,
  onCancel,
  onConfirm,
  onEditIdentity
}: StartScreenProps) {
  const inputField = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!identity && !busy) inputField.current?.focus({ preventScroll: true });
  }, [identity, busy]);
  // A local recovery question may have no provider receipt; do not invent completed research for it.
  const showActivity = Boolean(busy || !identity || identity.receipt || events.some(item => item.origin === "exa"));
  return <section className="landing no-print">
    <div className="hero">
      <h1 ref={heading} tabIndex={-1}>Find your next role.</h1>
    </div>
    {identity ? <IdentityStep identity={identity} busy={busy} onResearch={onResearch} onConfirm={onConfirm} onEdit={onEditIdentity} /> : <form
      className="start-form"
      onSubmit={event => {
        event.preventDefault();
        onResearch(input);
      }}
    >
      <label className="sr-only" htmlFor="candidate-input">Name, role, or profile link</label>
      <textarea
        id="candidate-input"
        ref={inputField}
        value={input}
        onChange={event => onInputChange(event.target.value)}
        rows={4}
        maxLength={8000}
        placeholder="Your name, role, or a profile link"
        required
        disabled={Boolean(busy)}
      />
      <div className="start-form-bottom">
        <button className="primary-button" disabled={Boolean(busy) || !input.trim() || configured === false}>{busy ? "Researching…" : "Research"} {!busy && <Arrow />}</button>
      </div>
    </form>}
    {showActivity && <ActivityFeed
      events={events}
      busy={busy}
      elapsed={elapsed}
      onCancel={onCancel}
      completionLabel={identity ? "Identity check complete" : undefined}
    />}
  </section>;
}
