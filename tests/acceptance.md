# MVP acceptance checklist

Record actual results when running these checks. A mocked provider response establishes application behavior, not live research quality.

## Deep contract and data integrity

- Identity, each employment entry, opportunity discovery, batch qualification, resume drafting, and separate semantic review all send `type: "deep"` to Exa `/search`.
- No route substitutes `auto`, ordinary search, or a prerecorded response after a provider error.
- Every output schema stays within Exa's ten-property definition budget and two object levels (root plus an item object). Arrays define `items`. Local validation rejects unsupported shapes before consuming a quota slot or announcing an Exa request.
- Grounding survives normalization even if a cited source is absent from `results`.
- Citation URLs allow only public-facing HTTP(S) links; unsafe schemes cannot become clickable links.
- A receipt includes the real request ID when supplied and does not invent cost or source counts.
- Only candidate-selected evidence is sent for opportunity matching and resume drafting.
- Unknown evidence IDs in a provider response cannot introduce unsupported resume claims.
- An unresolved candidate clarification prevents opportunity research.

## Candidate research depth

- After identity resolution, every identified employment entry receives a focused work-research request, even when initial research already found two facts for it. The maximum is ten entries, with at most two work requests in flight.
- Each request uses the established identity, employer, role, dates, source anchors, and existing claims. A namesake's work, company-wide achievement, event venue, or technology mention does not establish personal employment work.
- Research looks for actual responsibilities, deliverables, projects, and supported outcomes in profession-appropriate public sources. GitHub is useful when relevant, not a default for every occupation.
- Accessible experience descriptions and substantive pages are inspected; an inaccessible LinkedIn page is not represented as fully read. No part of the UI promises an exhaustive platform or web scrape.
- Bounded available source excerpts and field citations are retained without presenting them as a complete source archive. A citation or a count of facts is not proof of complete or accurate work history.
- Coverage distinguishes researched entries, missing public details, unavailable sources, and failures. Failure of one role request preserves other findings; cancellation stops scheduling new work.
- **Refresh research** researches every employer and defaults returned contributions to selected. This is inclusion, not a declaration of human verification. Qualification and semantic resume review still check support.

## Employer exclusions and job results

- The candidate's current employers, or most recent employer if none is current, are excluded by default. Earlier employers are not automatically excluded. Exclusions can be removed; an empty list stays empty when moving between screens or researching the same person again. Renaming an excluded employer updates that exclusion without re-adding removed companies. Browser refresh resets the whole flow, including preferences.
- Normalized company matching handles punctuation, case, and expected legal-name variations.
- An exclusion for `Meta` does not exclude `Metabase`; `Citadel` and `Citadel Securities` are not silently treated as identical.
- A shared ATS hostname does not cause all companies on that host to be excluded.
- One batch Deep qualification request checks the shortlisted roles against their primary employer/ATS postings. Discovery alone does not create a qualified result.
- Qualification receives a flat list of requirement records grouped by job ID. Repeated posting URLs and status must agree, at least one status citation must support that posting, and every requirement retains its own original field citation. Interleaved jobs cannot borrow one another's citations.
- Closed, unavailable, ungrounded, or aggregator-only postings are withheld by qualification. Requirement and status citations must support the exact primary posting rather than a general company page or another job.
- Requirements distinguish core responsibilities, explicit prerequisites, and preferences. Evidence is assessed as direct, transferable, or missing, with concrete reasons and valid selected evidence IDs.
- The fit gate requires at least two directly supported core responsibilities. Unknown or transferable required qualifications remain visible as gaps, not claims of complete qualification. Missing preferred evidence remains visible as a gap.
- Generic collaboration, API familiarity, or workshops do not become product ownership, roadmapping, or product launches. Requested function remains a constraint even when the candidate is changing careers.
- Location preference does not establish residence, work authorization, citizenship, or time-zone availability. Unknown prerequisites remain unknown.
- No match percentage, ATS score, or probability of hiring is generated. Strict filtering may return zero roles and may miss reasonable career-transition opportunities.
- No fabricated or invalid posting URL is turned into an application action.
- Zero suitable results leaves a useful empty state and lets the user revise preferences.

## Interactive flow

- Empty, too-long, and malformed input receive focused errors.
- An ambiguous input produces a clarification rather than merging identities.
- Enter `Aditi`, repeat `Aditi`, and reply `yes`: Deep assesses each submitted query, and an unresolved response never starts career research. Repetition must not be treated as new distinguishing evidence. Repeating an unchanged answer in the UI avoids an unnecessary resubmission.
- A context-rich query that Deep explicitly resolves, with one candidate and grounded identifying evidence, proceeds directly into career and employer research in the same request. No **This is me** click is required. Returned contributions appear selected, without representing them as manually verified.
- **Find roles** is enabled after research with selected evidence and the default role/location preferences. No **Profile reviewed** control exists. Deselecting a detail excludes it from job/resume payloads and invalidates dependent results. Clearing all contributions disables matching with a concise hint.
- Clicking **Find roles** immediately opens **Roles**, with the real activity feed below its heading while discovery and qualification run. A refresh clears the old shortlist and draft. Failure or cancellation keeps this pane available with **Try again** and **Preferences**; only a completed empty result shows the no-matches message.
- Editing a selected contribution preserves its selection, marks it user-provided, and removes old citations. Editing employment clears old citations and records user-provided information. Unknown employment remains uncertain; selection alone cannot turn it into verified history.
- An ambiguous or insufficient result stays in the input card even when it has one plausible candidate. Missing or malformed resolution, missing match evidence, an unresolved question, or multiple original candidates cannot silently become an automatic match by filtering down to one. Each offered name is grounded on its profile; namesakes remain separate.
- The follow-up and choices replace the original input form, above activity. Keyboard focus moves to the question or answer field. **None of these** and **Edit details** let the person correct the lookup.
- Edited input, invented confirmation, expired tokens, and an inconsistent selected identity cannot trigger employment enrichment. A later Deep response with a substituted name or missing selected-profile citation returns to clarification.
- While a new identity is unresolved, any earlier career data retained in the current page cannot be used for jobs or resumes. A failed confirmation returns to editable details instead of repeatedly sending a stale token. Refresh clears both the pending identity and earlier work.
- A professional outside software/DevRel receives the same usable input and review flow.
- A candidate can edit their name, summary, employment details, and evidence selections.
- Changing the profile or exclusions invalidates stale opportunities and resume output.
- Roles and location/work preferences must be explicitly supplied or deliberately left open through a supported option.
- Opening a role shows evidence and gaps; tailoring requires an explicit action.
- Name/contact fields are user-editable and never invented.
- Moving between app screens preserves the current workspace in memory. **New search** resets it.
- Refresh from Start, an identity follow-up, Profile, Jobs, or Resume: each reload opens blank Start with no previous input, findings, preferences, contact details, draft, or activity. A new tab also begins blank.
- No workspace is loaded from or written to browser storage. On startup, only `next-move.workspace.v1` and `next-move.workspace.v1.before-fit-review` are removed; unrelated keys remain. Corrupt legacy values or unavailable storage do not prevent starting a blank search.
- Job matching and drafting still require current qualification and review results within the current flow. Refreshing candidate research is a separate action from refreshing the browser.

## Live activity and failures

- The initial activity event corresponds to a real application request. Expanded events distinguish **App** workflow actions from **Exa** API events; legacy events without origin metadata do not acquire an invented provider origin.
- Provider activity uses actual `results`, `text-delta`, `grounding`, `stream-reset`, `done`, or `error` signals. An ordinary JSON response is identified as such rather than fabricated into a streaming trace.
- Exa's synthesis events are not represented as a log of its internal expanded searches, page-reading tools, or private reasoning.
- The collapsed panel shows concise active phases and elapsed time. Meaningful parallel role phases remain distinguishable; optional request details, event types, and real timestamps stay expandable.
- Source links are safe, deduplicated, and tied to returned source information. Repeated grounding updates do not create a wall of duplicate links.
- The interface never presents a fabricated query log, private reasoning trace, completion percentage, or timed sequence as real activity.
- Split SSE chunks, multiple events per chunk, multiline data, and end-of-stream boundaries parse correctly.
- A provider stream reset discards superseded partial output.
- The final completed response controls the claims and grounding retained in the current page.
- Provider `done` only completes a provider response; it does not claim the application's entire research/review workflow finished. Completion requires the final app result.
- **Stop** releases the UI, retains existing work in the open page, and prevents an old response overwriting a newer request. A browser refresh starts blank rather than restoring interrupted work.
- A pending event on cancellation remains incomplete. A failed role request is distinguishable from successful research, even if handling that failure has finished.
- A 400, 401, 402, 429, timeout, network error, or malformed provider response preserves existing selected work in the open page and displays an actionable error.
- The application never displays a key or raw authorization header in a UI error, console log, or research receipt.

## Resume and accessibility

- The draft contains only supported or user-entered material, preserving personal/team attribution.
- A new number, date, employer, or credential is not silently introduced during tailoring.
- Every generated bullet references selected evidence and assessed requirements actually supported by that evidence. A matching ID or shared keyword alone is insufficient.
- A separate Deep semantic review checks the summary, every bullet, and every skill for support and job relevance. Missing, conflicting, or malformed review entries fail closed; new candidate facts found during review cannot justify claims absent from the selected evidence.
- Check nonnumeric inflation explicitly: workshops must not become measured adoption gains; collaboration must not become roadmap ownership; contributing must not become leading. A second model pass reduces risk without proving truth.
- A conference, similarly named event, venue, technology, or current employer cannot establish employment attribution. Valid independent work stays separate; explicit user-reviewed grouping remains editable.
- Unsupported or irrelevant bullets and skills are removed. A summary that cannot be supported is omitted without blocking export by itself.
- Use 2–4 bullets for a recent relevant role as an editorial guideline and 6–8 total when evidence supports them. The draft cap is eight; fewer supported facts mean fewer bullets, never padded or invented accomplishments.
- Detailed experience appears only for employers with selected bullets. Other useful, non-uncertain history is compact under **Additional experience**; empty role headings do not fill the main section.
- Export requires a valid user-provided email and LinkedIn profile URL. Contact details are not invented, and missing or invalid values produce actionable checks.
- The user reviews the draft before export.
- Print preview contains only the resume, with selectable text and standard single-column reading order.
- Test short, long, and multipage drafts; check page breaks, clipping, contact links, and non-ASCII names.
- Test browser Save as PDF on the intended operating system; label the action accurately.
- Inputs have labels; the activity panel is keyboard operable; buttons and focus remain visible.
- The flow works at narrow phone width without horizontal scrolling or inaccessible controls.

## Runtime and spending

- Record actual receipts across the complete journey. With N employment entries, a successful identity resolution → career research → all work research → discovery → qualification → draft → review journey uses N + 6 Deep calls, up to 16 for ten entries before extra lookups or retries. Every valid nonempty identity query makes a Deep call; unresolved research stops after that call. Early exits can use fewer; refresh and regeneration add calls.
- Concurrency two limits parallel work requests, not their cost. Request receipt totals are based on provider-reported cost when present; the UI does not promise a fixed journey price.
- Candidate `maxDuration` is 960 seconds; opportunities and tailoring are each 360 seconds. Check the actual deployment host's permitted duration; these settings cannot override host limits.
- An in-memory workspace, in-process limits, and long HTTP requests are local-MVP constraints. A production acceptance review must consider durable background execution, resumable status, authentication, user-owned storage, and shared quotas.

## Live integration evidence still required

Use the configured key from a network-enabled local runtime. Preserve only redacted diagnostics.

1. Research a known candidate with minimal clues. Inspect the original sources for identity, employment freshness, and contribution attribution. Verify that every employment entry receives a focused request and that sparse or failed entries are reported honestly.
2. Start with a common first name, repeat it, then provide an affiliation. Verify the same-card follow-up and no employer requests while Deep reports uncertainty. Verify that resolving added context continues automatically; when multiple identities remain, select the intended profile. Edit the query and test expired selection recovery without treating any returned profile as globally unique.
3. Confirm a profile and discover opportunities, including a career-transition target. Inspect employer exclusions, original posting URLs, complete requirements, fit-gate decisions, and any zero-result explanation.
4. Tailor one qualified role. Compare every final bullet and skill against approved evidence and its job requirement, inspect the independent review's removals, add email/LinkedIn, and export to PDF. Check selectable text, reading order, page breaks, and links rather than claiming ATS success.
5. Capture actual request IDs, reported costs, end-to-end latency, and observed app/provider activity for all requests. Compare these to the expected call count; do not present a source list as an internal search trace.

Do not mark these live checks complete based solely on successful build, HTTP health, unit tests, or replayed fixture responses.
