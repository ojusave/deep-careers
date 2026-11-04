/**
 * Workflow 01 shows this card only when Deep could not resolve the identity.
 * A new detail lets Deep try again; “This is me” explicitly selects one of the uncertain matches.
 */
import { useEffect, useRef, useState } from "react";
import type { IdentityResolution } from "@/shared/types";
import { appendIdentityAnswer } from "@/frontend/browser/workspace";
import { safeHref } from "@/frontend/browser/research-stream";

type IdentityStepProps = {
  identity: IdentityResolution;
  busy: string | null;
  onResearch: (query: string) => void;
  onConfirm: (candidateId: string) => void;
  onEdit: () => void;
};

export function IdentityStep({ identity, busy, onResearch, onConfirm, onEdit }: IdentityStepProps) {
  const [answer, setAnswer] = useState("");
  const [addingDetail, setAddingDetail] = useState(!identity.candidates.length);
  const [hint, setHint] = useState("");
  const card = useRef<HTMLDivElement | null>(null);
  const question = useRef<HTMLHeadingElement | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);

  // Keep each follow-up where the original form was, even after a long activity feed.
  useEffect(() => {
    setAnswer("");
    setHint("");
    setAddingDetail(!identity.candidates.length);
  }, [identity]);
  useEffect(() => {
    if (busy) return;
    (addingDetail ? input.current : question.current)?.focus({ preventScroll: true });
    card.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [identity, addingDetail, busy]);

  return <div className="start-form identity-step" ref={card} aria-busy={Boolean(busy)}>
    <div className="identity-context">
      <p title={identity.query}>{identity.query}</p>
      <button type="button" className="text-button" disabled={Boolean(busy)} onClick={onEdit}>Edit details</button>
    </div>
    <h2 id="identity-question" ref={question} tabIndex={-1}>
      {addingDetail && identity.candidates.length ? "What will help identify you?" : identity.question || "Which profile is yours?"}
    </h2>
    {!addingDetail && <>
      <div className="identity-choices">
        {identity.candidates.map(candidate => <article className="identity-choice" key={candidate.id}>
          <div className="identity-choice-info">
            <h3>{candidate.name}</h3>
            {candidate.headline && <p>{candidate.headline}</p>}
            {candidate.employer && <p className="identity-employer">{candidate.employer}</p>}
            <a className="text-link" href={safeHref(candidate.profileUrl)} target="_blank" rel="noreferrer">View profile ↗</a>
          </div>
          <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => onConfirm(candidate.id)}>This is me</button>
        </article>)}
      </div>
      <button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => setAddingDetail(true)}>None of these · Add a detail</button>
    </>}
    {addingDetail && <form onSubmit={event => {
      event.preventDefault();
      const nextQuery = appendIdentityAnswer(identity.query, answer);
      if (!nextQuery) {
        setHint("Add something new, such as your full name, employer, or profile link.");
        input.current?.focus();
        return;
      }
      onResearch(nextQuery);
    }}>
      <label className="sr-only" htmlFor="identity-answer">Additional identifying details</label>
      <textarea id="identity-answer" ref={input} value={answer} onChange={event => {
        setAnswer(event.target.value);
        setHint("");
      }} aria-describedby={hint ? "identity-hint" : "identity-question"} rows={2} maxLength={8000} placeholder="Full name, employer, or a profile link" disabled={Boolean(busy)} required />
      {hint && <p id="identity-hint" className="helper-text" role="status">{hint}</p>}
      <div className="start-form-bottom">
        {identity.candidates.length > 0 && <button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => setAddingDetail(false)}>Back to profiles</button>}
        <button className="primary-button" disabled={Boolean(busy) || !answer.trim()}>{busy ? "Checking…" : "Continue"}</button>
      </div>
    </form>}
  </div>;
}
