import { account, guard, people } from '@/lib/store';

// GET → who is signed in and every member (?fresh=1: straight from the shared copy, for the Accounts page).
// POST → the admin adds a member, resets a password or removes one; a new password comes back once.
export async function GET(req: Request) {
  const no = guard(req);
  if (no) return no;
  try { return Response.json(await people(new URL(req.url).searchParams.has('fresh'))) }
  catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }) }
}

export async function POST(req: Request) {
  const no = guard(req);
  if (no) return no;
  try { return Response.json(await account(await req.json())) }
  catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }) }
}
