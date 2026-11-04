# Next Move — Exa Deep MVP

A focused career-research app: describe yourself, choose the evidence, discover relevant opportunities, and prepare a reviewed resume draft for a selected role.

Every research and review request explicitly calls Exa's `POST /search` endpoint with **`type: "deep"`**:

1. Let Deep resolve the person using their identifying context. Continue directly when its structured assessment and grounding support one identity; ask for clarification only when unresolved. Research that person's professional history, then **each** identified employment entry with a focused Deep request. A pool of two requests processes up to ten entries.
2. Discover opportunities using selected experience and preferences, then run one batch Deep qualification request against their original job postings.
3. Research the selected role and draft a resume, then make a separate Deep request to review factual support, job relevance, and employer attribution.

There is no automatic fallback to `auto`, ordinary search, or stored sample results. The application preserves field-level grounding, including citations whose URLs are absent from Exa's selected `results` array. Each completed stage exposes a research receipt with the selected mode, request ID, timing, and reported cost when available.

## Run locally

Use Node.js 24 and npm. The project is directly at `/Users/os/Downloads/ojus_code/deep-careers`. From this directory:

```sh
npm ci
```

Create `.env.local` from `.env.example` if it does not already exist, then set your Exa key:

```dotenv
EXA_API_KEY=your_key_here
```

The key is read only by the server. Do not use a `NEXT_PUBLIC_` variable or commit `.env.local`.

```sh
npm run dev
```

Open [http://localhost:3100](http://localhost:3100).

For a local production build:

```sh
npm run build
PORT=3100 npm start
```

Development binds to `127.0.0.1:3100`. Production binds to `0.0.0.0` and uses the host's `PORT` environment variable (or Next.js's default port when it is absent).

This working copy can reuse locally linked dependencies. When moving it to another machine, copy source files without `node_modules`, `.next`, or `.env.local`, then install dependencies and configure the key there.

## Deploy on Render

The included `render.yaml` defines one paid Node web service in Oregon using the `1c-2g` plan (1 CPU, 2 GB RAM). It runs both the UI and backend. The current code does not need a database, Redis, a worker, or a persistent disk.

- Build: `npm ci && npm run build`
- Start: `npm start`
- Health endpoint: `/api/health`
- Secret: set `EXA_API_KEY` in Render; never commit its value.
- Runtime: Node.js 24.22.1, pinned in `.node-version`.

Use one service instance: request quotas and identity-choice signing currently live in process memory. Render supplies `RENDER_EXTERNAL_URL`, which the API uses for its browser-origin check behind the HTTPS proxy. Set optional `APP_ORIGIN` only if you use a custom domain.

This is a configuration for deployment, not a record of a successful live deploy. Confirm the deployed page loads, health reports `configured: true`, and browser research requests stream correctly. The health endpoint checks configuration presence; it does not validate the Exa credential or spend credits.

## Where to start in the code

For a beginner-friendly explanation of Deep, the full architecture, every Exa parameter we use, and the current evidence-verification gaps, read [How this app uses Exa Deep](docs/exa-integration.md).

Read [the illustrated walkthrough](docs/how-it-works.md) first if this is your first time in the project. The three backend workflows are deliberately numbered so you can follow the sequence:

1. [01-research-person.ts](src/backend/workflows/01-research-person.ts) identifies the person and researches each employment entry.
2. [02-find-relevant-jobs.ts](src/backend/workflows/02-find-relevant-jobs.ts) discovers openings and checks their requirements against selected experience.
3. [03-create-resume.ts](src/backend/workflows/03-create-resume.ts) drafts a resume and runs a separate factual/relevance review.

The user can edit or deselect profile details between steps 1 and 2, then selects a job before step 3. Finding roles is an explicit action with usable defaults; no profile-review checkbox is required.

| Area | What belongs here | Start with |
|---|---|---|
| Frontend | Screens, interactions, in-memory browser state, and document presentation | [frontend/main.tsx](src/frontend/main.tsx) |
| Backend workflows | The ordered steps of each user action | [backend/workflows/](src/backend/workflows/) |
| Backend features | Candidate, job, and resume research rules and prompts | [backend/features/](src/backend/features/) |
| Exa provider | Authentication, Deep requests, event parsing, receipts, limits | [backend/providers/exa/deep.ts](src/backend/providers/exa/deep.ts) |
| Shared | Data definitions and functions safe to use on either side | [shared/types.ts](src/shared/types.ts) |
| Next.js routes | Thin page and API entry points | [app/page.tsx](src/app/page.tsx), [app/api/research/route.ts](src/app/api/research/route.ts) |

For one complete path, read **frontend/main → browser/research-stream → API route → numbered workflow → feature → Exa provider**. File comments explain purpose, inputs, outputs, and the reason for important checks. The `app/` directory contains UI routes and API routes; it is Next.js routing, not middleware.

## Use the flow

- Enter identifying context such as a name plus employer, profession, or profile link. You can include experience directly.
- Deep first investigates the identifying details. A supported resolution continues into career research automatically. If uncertainty remains, a question or sourced choices appear in the original input card. Add a detail, choose the correct profile, or edit the starting text. A single search result alone is not enough to continue.
- Researched contributions are selected by default. Deselect anything you do not want used, or edit the details. **Find roles** works immediately with **Open to suitable roles** and **Any location**; both preferences remain editable. No **Profile reviewed** checkbox is required. An empty contribution selection still needs at least one detail before searching.
- Employment uses **Current / most recent** and **Earlier**; uncertain entries retain **Needs review**. Only current employers—or the most recent employer when no current role is known—are excluded by default. Remove or add exclusions freely; an empty list remains empty during the session.
- Use **Refresh research** on an existing profile to run research for every employment entry. Returned contributions start selected. Per-role status distinguishes a completed request, unavailable or absent public detail, and a failed request. A completed search does not mean the work history is complete.
- Broad targets such as “product” ask which function you mean. Your requested function controls the search; prior experience only informs transferable fit and gaps. Results outside the requested title/function are filtered out.
- Find opportunities. Deep checks each shortlisted posting's requirements against selected work, separating direct, transferable, and missing evidence. A relevance gate can return fewer or zero roles; it never substitutes a prior job function to fill the screen. Open a role to inspect its requirements, gaps, and sources.
- Choose **Create resume** to generate and independently review a draft. Each bullet links selected evidence to an assessed requirement. Detailed experience contains only employers with selected bullets; other sourced or user-provided history is compact. Independent contributions remain separate unless employment attribution is supported. Use **Edit** for contact details, summary, wording, and employer grouping.
- Aim for **2–4 bullets for a recent relevant role and 6–8 total**. The draft has an eight-bullet cap, not a minimum quota: less supported relevant work means fewer bullets. Do not pad empty roles or add unproven impact to reach a count.
- The preview is selectable text. **Copy resume text**, text download, and PDF print use the same reviewed content. A valid contact email and LinkedIn profile URL are required before export. Insufficient selected work also needs attention. The summary is optional and is omitted when the review cannot support it.
- **Regenerate** in the resume's **More** menu repeats role research, drafting, and review while retaining the profile and preferences. **Refresh research** separately repeats candidate and per-employer research.
- Use **Save PDF** to open the browser print dialog and choose **Save as PDF**. This is a print-ready resume, not a promise of passing an employer's applicant tracking system.

Your work stays in memory while you move between screens in the current page. Browser refresh, closing the page, or opening a new tab starts a blank search. **New search** also resets the current flow. Download or copy a resume you want to keep.

## Research activity

The activity view stays collapsed to a short current phase and elapsed time. Expand it to see real events labeled **Exa** or **App**, deduplicated source links, and optional technical details. Parallel employment requests can report their actual role phases. App events describe workflow actions such as starting a request or checking evidence; Exa events describe what its API actually reports.

Exa's documented synthesis stream reports `results`, `text-delta`, `grounding`, `stream-reset`, `done`, and `error`. It does not expose the internal expanded-query or tool-reasoning trace. The UI does not invent that trace, claim a particular page was read without an event, or use a timer as a progress percentage. Provider `done` completes one response; application validation completes the workflow. Interrupted pending work remains incomplete. The final response is authoritative; partial synthesis is not a confirmed candidate fact. See [Deep Search streaming](https://exa.ai/docs/search/deep-search).

The server accepts `Accept: text/event-stream` for the interactive flow and ordinary JSON responses for integration checks. Application stream events are `activity`, `complete`, and `error`.

## HTTP interface

| Endpoint | Input | Successful result |
|---|---|---|
| `GET /api/health` | None | Whether the server has an Exa key configured; not a live credential or billing check |
| `POST /api/research` | `{ input, selectionToken? }` | A researched profile when Deep resolves the person or the user selects a valid offered choice; otherwise a follow-up question or sourced choices (`kind: "identity"`). The profile includes evidence, grounding, per-employer work coverage, and actual request receipts |
| `POST /api/opportunities` | `{ profile, preferences, employmentIncluded }` | Qualified shortlist, requirement/evidence assessments, grounding, receipts, exclusion/function/fit filter counts, missing evidence |
| `POST /api/tailor` | `{ profile, preferences, job, employmentIncluded }` | Role priorities, reviewed draft, evidence/requirement-linked bullets, employer grouping, supported skills, quality notes, gaps, grounding, draft/review receipts |

Errors return a useful message and code rather than substituting sample data. Qualification requires a readable primary employer/ATS posting, grounded requirements and availability, at least two directly supported core responsibilities. Unknown or transferable required qualifications remain visible as gaps; these opportunities are potential matches, not a claim of complete qualification. Unknown eligibility stays unknown. This is a relevance policy, not an ATS score or a prediction of hiring. Model-produced requirements and assessments can still be incomplete or wrong.

Candidate research retains bounded source excerpts when available, alongside field citations. This is not a complete archive or an exhaustive LinkedIn, GitHub, or public-web crawl. Unavailable pages and unpublished work require candidate input. A citation alone does not prove every assertion in a generated claim; source passages, identity, attribution, and candidate confirmation still need review. The separate draft review reduces unsupported claims without guaranteeing factual truth.

## Why Deep, and its tradeoffs

Deep handles iterative retrieval and synthesis inside `/search`. The application handles clarification, per-role scheduling, evidence selection, qualification gates, review, and document rendering. No external agent framework is required for this bounded flow. `additionalQueries` supplies useful starting directions for focused research; it is not a replacement for Deep's internal planning. `numResults: 10` controls returned pages, not internal search count. See [Deep Search](https://exa.ai/docs/search/deep-search).

Deep performs identity disambiguation using its own search, inspection, and refinement loop. Our schema asks for a resolution assessment and evidence connecting the person to the supplied details. The backend validates that result and continues without a confirmation click when one identity is explicitly resolved and supported. It does not infer resolution from result count or run a second search-planning loop. Missing or contradictory output stays unresolved. The [Search API](https://exa.ai/docs/reference/search) does not document a human-conversation mechanism: when clarification is needed, the app collects an answer and supplies that context in a new Deep request. The schema's resolution assessment is generated content, not a native identity guarantee. Contributions default to included; inclusion is not a claim of human verification. Job qualification and resume review still assess support and relevance.

A successful full journey with **N employment entries uses N + 6 Deep calls**: identity resolution (1), career research (1), work research (N), discovery (1), batch qualification (1), drafting (1), and semantic review (1). With ten entries that is up to 16 calls before retries. Every valid nonempty identity query, including a bare name, goes to Deep; an unresolved lookup stops after that call. This uses more time and credit than a local name heuristic but delegates ambiguity assessment to Deep. Additional lookups, regeneration, and refresh incur new calls; empty discovery or failed gates can stop earlier. The two-request candidate pool limits concurrency, not total cost. Receipts retain actual reported costs rather than promising a fixed journey price.

Route `maxDuration` values are 960 seconds for candidate research and 360 seconds each for opportunities and tailoring. These are configuration hints, not guarantees that a deployment host permits those durations. Production hosting may require durable background jobs and resumable status delivery. Structured outputs use focused schemas within Exa's property/nesting limits; unavailable details remain gaps.

The target-role filter is intentionally conservative and may omit unfamiliar job-title synonyms. It prevents unrelated functions from silently replacing a requested one, but is not an exhaustive occupational classifier. Provider citations, returned job status, work coverage, and resume quality still need human evaluation on live cases.

## Checks

```sh
npm run typecheck
npm test
npm run build
```

The test command uses Node's test discovery to find the nested suites. [tests/backend/](tests/backend/) checks workflows, features, and the Exa adapter; [tests/frontend/](tests/frontend/) checks browser streaming and rendering; [tests/shared/](tests/shared/) checks reusable logic.

See [the acceptance checklist](tests/acceptance.md) for the complete flow, failure cases, and live provider checks. Automated tests use controlled responses; they do not establish that a live Exa request or a real job recommendation succeeded.

TypeScript checking, automated tests (including resume document rendering and text export), and the Next.js production build are checked during implementation. The execution sandbox could not resolve external API hosts or bind a local HTTP server. The cached Playwright package also lacked an accessible browser executable. Live Exa integration, browser interaction, and exported-PDF visual checks therefore need to be run from the user's local terminal before treating the MVP as verified end to end.

## MVP boundaries

- This remains a local MVP. Its workspace exists only in the current page's memory; there is no account system, database, or automatic restore after refresh. Startup removes the two known workspace keys left by older versions without clearing unrelated browser storage.
- **Stop** cancels the current request while retaining existing work in the open page. Refreshing or closing the page discards that in-memory work. A server restart can interrupt research. Already-issued provider requests may still incur charges.
- Offered identity choices carry a signed token valid for 15 minutes and the current server process. A restart or expiry requires a fresh lookup. Multi-instance hosting would need a shared signing key or stored selections. This token binds an offered choice to its query; it does not authenticate the person.
- Rate/concurrency limits in one process are not a distributed spending-control system.
- All research requires a configured Exa key with available credit and server network access. An HTTP health response only proves configuration is present.
- Employer exclusions are applied to normalized company names; subsidiaries, aliases, and ambiguous hiring entities should be reviewed.
- Opportunity status is reported from research. This MVP does not guarantee that every employer is still accepting applications.
- The resume draft uses approved evidence and still requires a human review. The app does not submit applications.
- A public launch needs durable user-owned storage, authentication, a shared quota system, operational monitoring, and broader identity/job/document evaluation.

The larger architecture research is in `/Users/os/Downloads/ojus_code/2026-11-03/al/outputs/exa-career-product-research.md`. This MVP concentrates on making Deep's researched evidence visible through one complete user journey.
