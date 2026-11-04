/** Next.js endpoint: hand the request to the matching numbered backend workflow. */
import { researchResponse } from '../../../backend/http/response.ts';
import { tailorResume } from '../../../backend/workflows/03-create-resume.ts';

export const runtime = 'nodejs';
export const maxDuration = 360;
export function POST(request: Request) { return researchResponse(request, tailorResume); }
