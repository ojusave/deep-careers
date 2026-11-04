/** Report whether a server key is configured; this does not test Exa credentials. */
export const runtime = 'nodejs';
export function GET() {
  return Response.json({ configured: !!process.env.EXA_API_KEY?.trim() }, { headers: { 'Cache-Control': 'no-store' } });
}
