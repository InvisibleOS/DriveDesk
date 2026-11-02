import { guard, placed } from '@/lib/store';

// GET → every placed student: the committee's list from before DriveDesk, then everyone selected in a drive. Read-only.
export async function GET(req: Request) {
  const no = guard(req);
  if (no) return no;
  try { return Response.json({ placed: await placed() }) }
  catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }) }
}
