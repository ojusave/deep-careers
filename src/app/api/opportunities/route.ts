/** Next.js endpoint: hand the request to the matching numbered backend workflow. */
import { researchResponse } from '../../../backend/http/response.ts';
import { researchOpportunities } from '../../../backend/workflows/02-find-relevant-jobs.ts';

export const runtime = 'nodejs';
export const maxDuration = 360;
export function POST(request: Request) { return researchResponse(request, researchOpportunities); }
