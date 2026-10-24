import { denied, signIn, signOut, syncStatus } from '@/lib/store';

// GET → is this laptop signed in, and how many changes wait to go up. POST { username, password } → sign in. DELETE → sign out.
// Only the PIN guards these (phones on the Wi-Fi): signing in is how the sign-in gate is passed.
const pinOnly = (req: Request) => denied(req) === 'pin' && Response.json({ error: 'PIN required', gate: 'pin' }, { status: 401 });

export async function GET(req: Request) {
  return pinOnly(req) || Response.json(syncStatus());
}

export async function POST(req: Request) {
  const no = pinOnly(req);
  if (no) return no;
  try {
    const { username, password } = await req.json();
    await signIn(String(username ?? ''), String(password ?? ''));
    return Response.json(syncStatus());
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const no = pinOnly(req);
  if (no) return no;
  signOut();
  return Response.json({ ok: true });
}
