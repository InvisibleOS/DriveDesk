// The committee's shared copy of every drive, in Supabase (table public.drives: id, data, updated_at).
// Only talks to Supabase: signing a member in and out, and reading / writing rows as that member. What to upload and
// when lives in lib/store.ts. Plain fetch against Supabase's REST endpoints, no client library.
import fs from 'node:fs';
import path from 'node:path';
import type { Drive } from './drive';

const BASE = 'https://egmazhtnqzaxwyazbmrg.supabase.co';
const KEY = 'sb_publishable_aniYjwCwpO9Rqf1-Glaspg_rwmtt4Vk'; // public by design: the table's rules allow nothing without a member's sign-in

type Session = { access_token: string; refresh_token: string; expires_at: number; email: string };
export type Row = { id: string; updated_at: string; data?: Drive };

let file = '', session: Session | null = null;
export function init(dataDir: string) {
  file = path.join(dataDir, 'session.json');
  try { session = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { session = null }
}
const keep = (s: Session | null) => {
  session = s;
  if (s) fs.writeFileSync(file, JSON.stringify(s), { mode: 0o600 }); // only this user can read the sign-in
  else fs.rmSync(file, { force: true });
};
// people sign in with a username; Supabase needs an email behind it, so 'pcom' is pcom@drivedesk.local (never mailed)
const DOMAIN = '@drivedesk.local';
export const who = () => session ? session.email.replace(DOMAIN, '') : null;

// Supabase answers errors as { msg } or { error_description } or { message }
async function call(url: string, init: RequestInit) {
  const r = await fetch(url, { ...init, headers: { apikey: KEY, 'Content-Type': 'application/json', ...init.headers } });
  const j = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(Error(j?.msg || j?.error_description || j?.message || `Supabase said ${r.status}`), { status: r.status, code: j?.error_code });
  return j;
}

const auth = (grant: string, body: object) => call(`${BASE}/auth/v1/token?grant_type=${grant}`, { method: 'POST', body: JSON.stringify(body) });
const save = (j: { access_token: string; refresh_token: string; expires_in: number; user: { email: string } }) =>
  keep({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + j.expires_in * 1000, email: j.user.email });

export async function signIn(username: string, password: string) {
  const name = username.trim().toLowerCase();
  try { save(await auth('password', { email: name.includes('@') ? name : name + DOMAIN, password })) }
  catch (e) {
    const code = (e as { code?: string }).code;
    throw Error(code === 'invalid_credentials' ? 'Wrong username or password'
      : code === 'email_not_confirmed' ? 'This account isn\u2019t confirmed yet. In Supabase, confirm the user (or create it again with Auto Confirm ticked)'
      : (e as Error).message);
  }
}
export const signOut = () => keep(null);

// a valid access token, refreshed a minute before it runs out; a refused refresh means signed out
async function token() {
  if (!session) throw Error('Signed out');
  if (session.expires_at - 60_000 < Date.now()) {
    try { save(await auth('refresh_token', { refresh_token: session.refresh_token })) }
    catch (e) { if ((e as { status?: number }).status === 400) keep(null); throw e }
  }
  return session!.access_token;
}

const rest = async (q: string, init: RequestInit = {}) =>
  call(`${BASE}/rest/v1/drives${q}`, { ...init, headers: { Authorization: `Bearer ${await token()}`, ...init.headers } });

// every drive's id and when it last changed: small enough to ask for every few seconds
export const changes = (): Promise<Row[]> => rest('?select=id,updated_at');
export const fetchDrives = (ids: string[]): Promise<Row[]> =>
  rest(`?select=id,updated_at,data&id=in.(${ids.map(i => `"${i}"`).join(',')})`);

// insert or replace one drive; answers with the row's new updated_at, which is how later changes are recognised
export async function upload(d: Drive): Promise<string> {
  const [r] = await rest('?on_conflict=id&select=updated_at', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify([{ id: d.id, data: d, updated_at: new Date().toISOString() }]),
  });
  return r.updated_at;
}
// gone for good from the shared copy; the other laptops notice the missing row and drop it too
export const erase = (id: string) => rest(`?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
