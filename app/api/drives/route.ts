import { create, guard, list, placed } from '@/lib/store';

// GET → every drive's summary (dashboard + calendar) and who is already placed (for a new drive's student list). POST → start a new drive from the onboarding answers.
export async function GET(req: Request) {
  const no = guard(req);
  if (no) return no;
  return Response.json({ drives: list(), placed: placed() });
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
