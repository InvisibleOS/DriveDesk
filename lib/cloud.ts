// The committee's shared copy of every drive, in Supabase (supabase/schema.sql: drives, volunteer requests, accounts).
// Only talks to Supabase: signing a member in and out, and reading / writing rows as that member; the database's rules
// decide what each role may do. What to upload and when lives in lib/store.ts. Plain fetch, no client library.
import fs from 'node:fs';
import path from 'node:path';
import type { Ask, Campus, Drive, Member, PhaseId, Placed, Role } from './drive';

const BASE = 'https://egmazhtnqzaxwyazbmrg.supabase.co';
const KEY = 'sb_publishable_aniYjwCwpO9Rqf1-Glaspg_rwmtt4Vk'; // public by design: the table's rules allow nothing without a member's sign-in

// role and name: from the account (set on the Accounts page); a sign-in saved before roles had neither, and is refreshed
type Session = { access_token: string; refresh_token: string; expires_at: number; email: string; id?: string; role?: Role; name?: string };
export type Row = { id: string; updated_at: string; data?: Drive };

let file = '', session: Session | null = null;
export function init(dataDir: string) {
  file = path.join(dataDir, 'session.json');
  try { session = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { session = null }
  if (session && !session.role) session.expires_at = 0; // from before roles: the next request refreshes it and learns them
}
const keep = (s: Session | null) => {
  session = s;
  if (s) fs.writeFileSync(file, JSON.stringify(s), { mode: 0o600 }); // only this user can read the sign-in
  else fs.rmSync(file, { force: true });
};
// people sign in with a username; Supabase needs an email behind it, so 'pcom' is pcom@drivedesk.local (never mailed)
const DOMAIN = '@drivedesk.local';
export const who = () => session ? session.email.replace(DOMAIN, '') : null;
// who is signed in here and what they may do; until a pre-roles sign-in is refreshed, the least (a junior)
export const me = () => session ? { user: who()!, name: session.name ?? who()!, role: session.role ?? 'junior' } as Member : null;

// Supabase answers errors as { msg } or { error_description } or { message }
async function call(url: string, init: RequestInit) {
  const r = await fetch(url, { ...init, headers: { apikey: KEY, 'Content-Type': 'application/json', ...init.headers } });
  const j = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(Error(j?.msg || j?.error_description || j?.message || `Supabase said ${r.status}`), { status: r.status, code: j?.error_code });
  return j;
}

const auth = (grant: string, body: object) => call(`${BASE}/auth/v1/token?grant_type=${grant}`, { method: 'POST', body: JSON.stringify(body) });
type Grant = { access_token: string; refresh_token: string; expires_in: number; user: { id: string; email: string; app_metadata?: { role?: Role; name?: string } } };
const save = ({ user: u, ...j }: Grant) => keep({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + j.expires_in * 1000,
  email: u.email, id: u.id, role: u.app_metadata?.role ?? 'junior', name: u.app_metadata?.name });

export async function signIn(username: string, password: string) {
  const name = username.trim().toLowerCase();
  try {
    const g: Grant = await auth('password', { email: name.includes('@') ? name : name + DOMAIN, password });
    if (!g.user.app_metadata?.role) throw Object.assign(Error(), { code: 'no_role' }); // not made on the Accounts page
    save(g);
  }
  catch (e) {
    const code = (e as { code?: string }).code;
    throw Error(code === 'invalid_credentials' ? 'Wrong username or password'
      : code === 'email_not_confirmed' ? 'This account isn\u2019t confirmed yet. In Supabase, confirm the user (or create it again with Auto Confirm ticked)'
      : code === 'no_role' ? 'This account isn\u2019t a DriveDesk member. Ask the placement coordinator to add you'
      : (e as Error).message);
  }
}
export const signOut = () => keep(null);

// a valid access token, refreshed a minute before it runs out; a refused refresh (removed, or a new password) means signed out
export async function token() {
  if (!session) throw Error('Signed out');
  if (session.expires_at - 60_000 < Date.now()) {
    try { save(await auth('refresh_token', { refresh_token: session.refresh_token })) }
    catch (e) { if ((e as { status?: number }).status === 400) keep(null); throw e }
  }
  return session!.access_token;
}

const api = async (q: string, init: RequestInit = {}) =>
  call(`${BASE}/rest/v1/${q}`, { ...init, headers: { Authorization: `Bearer ${await token()}`, ...init.headers } });
const rest = (q: string, init?: RequestInit) => api(`drives${q}`, init);

// every drive's id and when it last changed: small enough to ask for every few seconds
export const changes = (): Promise<Row[]> => rest('?select=id,updated_at');
export const fetchDrives = (ids: string[]): Promise<Row[]> =>
  rest(`?select=id,updated_at,data&id=in.(${ids.map(i => `"${i}"`).join(',')})`);

// insert or replace one drive; answers with the row's new updated_at, which is how later changes are recognised.
// A junior only ever changes drives they volunteer at: when the rules don't let them (status 403), the shared copy wins.
export async function upload(d: Drive): Promise<string> {
  if (session?.role === 'junior') {
    const [r] = await rest(`?id=eq.${encodeURIComponent(d.id)}&select=updated_at`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ data: d, updated_at: new Date().toISOString() }),
    });
    if (!r) throw Object.assign(Error('Only this drive\u2019s volunteers can change it'), { status: 403 });
    return r.updated_at;
  }
  const [r] = await rest('?on_conflict=id&select=updated_at', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify([{ id: d.id, data: d, updated_at: new Date().toISOString() }]),
  });
  return r.updated_at;
}
// gone for good from the shared copy; the other laptops notice the missing row and drop it too
export const erase = (id: string) => rest(`?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });

// --- volunteering: a member asks for a phase of a drive, a senior approves (they join its volunteers) or denies ---
type AskRow = { drive_id: string; phase: PhaseId; user_id: string; username: string; status: Ask['status']; asked_at: string };
export const asks = async (): Promise<Ask[]> => (await api('volunteer_requests?select=drive_id,phase,user_id,username,status,asked_at') as AskRow[])
  .map(r => ({ drive: r.drive_id, k: r.phase, id: r.user_id, user: r.username, status: r.status, at: Date.parse(r.asked_at) }));
// asking again after being taken off a phase reuses the old request
export const ask = (drive: string, k: PhaseId) => api('volunteer_requests?on_conflict=drive_id,phase,user_id', {
  method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
  body: JSON.stringify([{ drive_id: drive, phase: k, user_id: session?.id, status: 'pending', asked_at: new Date().toISOString() }]),
});
export const withdraw = (drive: string, k: PhaseId) =>
  api(`volunteer_requests?drive_id=eq.${encodeURIComponent(drive)}&phase=eq.${k}&user_id=eq.${session?.id}`, { method: 'DELETE' });
export const decide = (drive: string, k: PhaseId, id: string, status: 'approved' | 'denied') =>
  api(`volunteer_requests?drive_id=eq.${encodeURIComponent(drive)}&phase=eq.${k}&user_id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ status, decided_by: who() }) });

// --- accounts (the admin's Accounts page; the database refuses anyone else) ---
type MemberRow = { id: string; username: string; name: string; role: Role; created_at: string; last_sign_in_at: string | null };
const rpc = (fn: string, args: object = {}) => api(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
// the committee's list of students placed before DriveDesk (loaded into the shared copy; nobody edits it in the app)
type PlacedRow = { reg: string; name: string; campus: Campus; company: string; placed_on: string | null };
export const placed = async (): Promise<Placed[]> => (await api('placed?select=reg,name,campus,company,placed_on') as PlacedRow[])
  .map(p => ({ reg: p.reg, name: p.name, campus: p.campus, company: p.company, date: p.placed_on ?? '' }));
export const members = async (): Promise<Member[]> => (await rpc('desk_members') as MemberRow[])
  .map(m => ({ id: m.id, user: m.username, name: m.name, role: m.role, since: Date.parse(m.created_at), seen: m.last_sign_in_at ? Date.parse(m.last_sign_in_at) : null }));
export const addMember = (user: string, name: string, role: Role, password: string) =>
  rpc('desk_add_member', { p_username: user, p_name: name, p_role: role, p_password: password });
export const setPassword = (id: string, password: string) => rpc('desk_set_password', { p_id: id, p_password: password });
export const removeMember = (id: string) => rpc('desk_remove_member', { p_id: id });
