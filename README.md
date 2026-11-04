<div align="center">

# Next Move

Research your experience, find relevant jobs, and build a resume with **Exa Deep**.

[![Exa Deep](https://img.shields.io/badge/Exa-Deep_Search-111111)](https://exa.ai)
[![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Node.js](https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Render](https://img.shields.io/badge/Render-Web_Service-46E3B7?logo=render&logoColor=white)](https://render.com)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Fojusave%2Fdeep-careers)

[Run locally](#run-locally) · [How it works](#how-it-works) · [Code walkthrough](docs/how-it-works.md) · [Exa integration](docs/exa-integration.md)

</div>

Next Move turns public career research into a job search you can inspect. Start with a name, employer, or profile link. Review the experience it finds, choose the work you want to use, and search for roles. Pick a job to generate a resume draft with sources behind its bullets.

## Features

- Research a person's career and individual roles, with follow-up questions when their identity is unclear.
- Edit or deselect experience before using it to find jobs.
- Search by role and location, with editable employer exclusions.
- Compare job requirements with direct, transferable, and missing evidence.
- Draft a tailored resume, then run a separate review for factual support and employer attribution.
- Edit the draft, copy or download the text, or save a PDF through the browser print dialog.
- Inspect research activity, sources, and request receipts, including reported cost when available.

## How it works

| Step | What happens |
| --- | --- |
| **Research** | Exa Deep resolves the person, researches their career, and makes a focused request for each employment entry. |
| **Find roles** | Selected experience and preferences guide discovery. A separate request checks the shortlist against original job postings. |
| **Create resume** | Deep researches the selected role and drafts a resume. Another request reviews the draft before it appears for editing and export. |

Every research and review request uses Exa's `/search` endpoint with `type: "deep"`. The app handles evidence selection, validation, and resume rendering without an external agent framework. Failed requests return errors rather than sample results.

A full journey with **N employment entries uses N + 6 Deep calls** before retries or refreshes. Up to ten employment entries are researched, with two requests running at once. Refreshing research or regenerating a resume makes new paid requests.

See [How this app uses Exa Deep](docs/exa-integration.md) for request parameters, grounding, streaming, and tradeoffs.

## Run locally

Use **Node.js 24** and an **Exa API key with available credit**.

```bash
git clone https://github.com/ojusave/deep-careers.git
cd deep-careers
npm ci
cp .env.example .env.local
```

Add your key to `.env.local`:

```dotenv
EXA_API_KEY=your_key_here
```

The key stays on the server. Keep `.env.local` out of version control.

```bash
npm run dev
```

Open [localhost:3100](http://localhost:3100).

For a local production build:

```bash
npm run build
PORT=3100 npm start
```

## Deploy on Render

Click **Deploy to Render** above, or create a Blueprint in the [Render Dashboard](https://dashboard.render.com) using this repository. Set `EXA_API_KEY` when prompted.

The included [render.yaml](render.yaml) creates one **paid Node web service** for the UI and API. No database, worker, or persistent disk is required.

| Setting | Value |
| --- | --- |
| Runtime | Node.js 24.22.1 |
| Plan | `1c-2g` — 1 CPU, 2 GB RAM |
| Region | Oregon |
| Build | `npm ci && npm run build` |
| Start | `npm start` |
| Health check | `/api/health` |
| Instances | 1 |

Keep one instance: request limits and identity-choice signing live in process memory. Render supplies the public URL automatically; set `APP_ORIGIN` if you use a custom domain.

After deployment, check that the page loads, `/api/health` reports `configured: true`, and a research request completes. The health endpoint checks whether a key is present; it does not validate the credential or call Exa.

## Key files

| File | What it does |
| --- | --- |
| [src/frontend/main.tsx](src/frontend/main.tsx) | Screens and in-memory workspace |
| [01-research-person.ts](src/backend/workflows/01-research-person.ts) | Identity and career research |
| [02-find-relevant-jobs.ts](src/backend/workflows/02-find-relevant-jobs.ts) | Job discovery and qualification |
| [03-create-resume.ts](src/backend/workflows/03-create-resume.ts) | Resume drafting and review |
| [src/backend/providers/exa/deep.ts](src/backend/providers/exa/deep.ts) | Exa requests, streaming, and receipts |
| [src/shared/types.ts](src/shared/types.ts) | Shared data definitions |
| [render.yaml](render.yaml) | Render Blueprint |

For a guided tour, read the [code walkthrough](docs/how-it-works.md).

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Check server configuration |
| `POST` | `/api/research` | Research a person or return an identity follow-up |
| `POST` | `/api/opportunities` | Find and qualify jobs using selected experience |
| `POST` | `/api/tailor` | Draft and review a resume for a selected job |

The POST endpoints support JSON responses and `Accept: text/event-stream`. The interactive flow streams `activity`, `complete`, and `error` events.

## Current limits

- **Work stays in the current page's memory.** Refreshing, closing the page, or starting a new search clears it. Copy or download resumes you want to keep.
- Public research can miss private profiles, unpublished work, or recent changes. Review the sources, job availability, and resume wording before using them.
- Job matching can return fewer roles or no matches. Gaps remain visible; a match is not a hiring prediction or an ATS score.
- Resume export requires an email address and LinkedIn profile URL. **Save PDF** uses the browser print dialog. The app does not submit applications.
- Stopping a request retains existing work in the open page, but provider requests already sent may still incur charges.
- This is an MVP with no accounts or durable storage. A public launch needs shared quotas, authentication, monitoring, and evaluation of live research and exported documents.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

Automated tests use controlled provider responses. Use the [acceptance checklist](tests/acceptance.md) to verify live Exa requests, browser interactions, and PDF exports.
