import { guard, me, openAsks, volunteer } from '@/lib/store';
import { lead } from '@/lib/drive';

// GET → the volunteer requests waiting for a senior (none for a junior). POST { drive, k, what, user? } → ask, withdraw,
// approve or deny one.
export async function GET(req: Request) {
  const no = guard(req);
  if (no) return no;
  return Response.json({ open: lead(me()) ? openAsks() : [] });
}

export async function POST(req: Request) {
  const no = guard(req);
  if (no) return no;
  try {
    const { drive, k, what, user } = await req.json();
    return Response.json({ msg: await volunteer(String(drive), k, what, user) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
