/** Next.js endpoint: hand the request to the matching numbered backend workflow. */
import { researchResponse } from '../../../backend/http/response.ts';
import { researchCandidate } from '../../../backend/workflows/01-research-person.ts';

export const runtime = 'nodejs';
export const maxDuration = 960;
export function POST(request: Request) { return researchResponse(request, researchCandidate); }
