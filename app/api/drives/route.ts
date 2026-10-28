import { asksFor, create, guard, list, me, ready } from '@/lib/store';

// GET → every drive's summary (dashboard + calendar), who is signed in and their volunteer requests.
// POST → a senior creates a new drive.
export async function GET(req: Request) {
  const no = guard(req);
  if (no) return no;
  await ready();
  return Response.json({ drives: list(), me: me(), asks: asksFor() });
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
