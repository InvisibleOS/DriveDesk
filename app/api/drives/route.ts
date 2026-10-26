import { create, guard, list } from '@/lib/store';

// GET → every drive's summary (dashboard + calendar). POST → start a new drive from the onboarding answers.
export async function GET(req: Request) {
  const no = guard(req);
  if (no) return no;
  return Response.json({ drives: list() });
}

export async function POST(req: Request) {
  const no = guard(req);
  if (no) return no;
  try {
    return Response.json({ id: create(await req.json()) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
