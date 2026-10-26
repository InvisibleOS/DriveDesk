// Server-side source of truth: every drive in memory, one file each in data/drives/, changes pushed to open screens.
// Every few seconds drives changed here go up to the committee's shared copy (lib/cloud.ts) and drives changed on
// other laptops come down; offline, changes simply wait.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cloud from './cloud';
import { alsoIn, apply, migrate, newDrive, planDrive, QUIET, summary, type Action, type Drive, type DriveConfig, type Plan } from './drive';

const DATA = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DIR = path.join(DATA, 'drives'), TRASH = path.join(DATA, 'trash'), STATE = path.join(DATA, 'sync.json');
// rev counts changes made here, pushed is the rev last uploaded: they differ while a change waits to go up
type Live = { d: Drive; undo: { snap: string; label: string }[]; subs: Set<(payload: string) => void>; rev: number; pushed: number };
// remote: each drive's updated_at as last seen in the shared copy; at: its file's time when last uploaded or downloaded
// (a later file time means a change still has to go up, even after a restart); gone: deletions not uploaded yet
type SyncState = { device: string; remote: Record<string, string>; at: Record<string, number>; gone: string[] };

// this laptop, for "being run on …": everyone signs in with the one committee account, so the computer's name tells them apart
const HERE = os.hostname().replace(/\.local$/, '').replace(/-/g, ' ');
const HOLD = 10 * 60_000; // a live drive stays with the laptop that last changed it for this long

function save(d: Drive) {
  const f = path.join(DIR, `${d.id}.json`);
  fs.writeFileSync(f + '.tmp', JSON.stringify(d));
  fs.renameSync(f + '.tmp', f); // atomic: a crash mid-write never leaves a half file
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'drive';
function uniqueId(m: Map<string, Live>, d: Drive) {
  const base = `${d.date}-${slug(d.company)}`;
  let id = base;
  for (let i = 2; m.has(id); i++) id = `${base}-${i}`;
  return id;
}

// ponytail: all drives live in one process's memory; run a single `next start` (not serverless)
const g = globalThis as unknown as { __drives?: Map<string, Live>; __sync?: SyncState };
const st = () => g.__sync!;
const keepState = () => { fs.writeFileSync(STATE + '.tmp', JSON.stringify(st())); fs.renameSync(STATE + '.tmp', STATE) };

function drives() {
  if (g.__drives) return g.__drives;
  fs.mkdirSync(DIR, { recursive: true });
  cloud.init(DATA);
  try { g.__sync = JSON.parse(fs.readFileSync(STATE, 'utf8')) } catch { g.__sync = { device: crypto.randomUUID(), remote: {}, at: {}, gone: [] } }
  const m = new Map<string, Live>();
  for (const f of fs.readdirSync(DIR)) if (f.endsWith('.json')) {
    const d = migrate(JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')));
    d.id = f.slice(0, -5);
    const stale = fs.statSync(path.join(DIR, f)).mtimeMs > (st().at[d.id] ?? 0); // never uploaded, or changed since
    m.set(d.id, { d, undo: [], subs: new Set(), rev: stale ? 1 : 0, pushed: 0 });
  }
  // the single-drive version kept everything in data/drive.json: bring it in once
  const legacy = path.join(DATA, 'drive.json');
  if (fs.existsSync(legacy)) {
    const d = migrate(JSON.parse(fs.readFileSync(legacy, 'utf8')));
    d.id = uniqueId(m, d);
    m.set(d.id, { d, undo: [], subs: new Set(), rev: 1, pushed: 0 });
    save(d);
    fs.renameSync(legacy, path.join(DATA, 'drive.imported.json'));
  }
  g.__drives = m;
  setInterval(sync, 5000);
  setTimeout(sync, 500);
  return m;
}

// Optional: set DESK_PIN so only people with the PIN can see or change drives (phones joining over the Wi-Fi).
// The desk itself opens only once this laptop is signed in to the committee account.
export const denied = (req: Request): 'pin' | 'signin' | null => {
  const pin = process.env.DESK_PIN;
  if (pin && new URL(req.url).searchParams.get('pin') !== pin) return 'pin';
  drives(); // loads the saved sign-in
  return cloud.who() ? null : 'signin';
};

// the 401 every desk route answers with when the PIN or the sign-in is missing; `gate` tells the page which screen to show
export function guard(req: Request) {
  const no = denied(req);
  return no && Response.json({ error: no === 'pin' ? 'PIN required' : 'Sign in to the committee account first', gate: no }, { status: 401 });
}

export const list = () => [...drives().values()].map(l => summary(l.d)).sort((a, b) => b.startedAt - a.startedAt);
export const get = (id: string) => drives().get(id);

// who else is running this live drive right now, if anyone: changes are refused here until someone takes over
const heldBy = (d: Drive) => d.status === 'live' && d.host && d.host.device !== st().device && Date.now() - d.host.at < HOLD ? d.host.name : null;
// also: this drive's present students who are present in another live drive too, and what they are doing there
const liveDrives = () => [...drives().values()].filter(o => o.d.status === 'live').map(o => o.d);
export const payload = (l: Live) => JSON.stringify({ drive: l.d, undo: l.undo.at(-1)?.label ?? null, held: heldBy(l.d), also: alsoIn(l.d, liveDrives()), now: Date.now() });
// a change to one drive can change what the other open drives show about shared students
const tell = (l: Live) => { const p = payload(l); l.subs.forEach(send => send(p)) };
const tellAll = () => { for (const l of drives().values()) if (l.subs.size) tell(l) };

export function create(c: DriveConfig & { plan?: Plan }) {
  const m = drives(), d = c.rooms ? newDrive(c, '') : planDrive(c, ''); // no cabins yet = booked for a later day
  d.id = uniqueId(m, d);
  m.set(d.id, { d, undo: [], subs: new Set(), rev: 1, pushed: 0 });
  save(d);
  return d.id;
}

function trash(id: string) {
  fs.mkdirSync(TRASH, { recursive: true });
  fs.renameSync(path.join(DIR, `${id}.json`), path.join(TRASH, `${id}-${Date.now()}.json`)); // recoverable, never unlinked
  drives().delete(id);
}

export function remove(id: string) {
  if (!drives().has(id)) throw Error('Drive not found');
  trash(id);
  st().gone.push(id);
  keepState();
}

function commit(l: Live) {
  if (l.d.status === 'live') l.d.host = { device: st().device, name: HERE, at: Date.now() }; // this laptop is running it
  l.rev++;
  save(l.d);
  tellAll();
}

export function dispatch(id: string, a: Action | { type: 'undo' } | { type: 'takeOver' }): string | undefined {
  const l = get(id);
  if (!l) throw Error('Drive not found');
  if (a.type === 'takeOver') { commit(l); return 'This laptop is running the drive now' }
  const other = heldBy(l.d);
  if (other) throw Error(`This drive is being run on ${other}. Take over to run it here`);
  if (l.d.status === 'done' && a.type !== 'reopen') throw Error('This drive has ended. Reopen it to make changes');
  if (a.type === 'undo') {
    const u = l.undo.pop();
    if (!u) throw Error('Nothing to undo');
    l.d = JSON.parse(u.snap);
    commit(l);
    return `Undone: ${u.label}`;
  }
  const snap = JSON.stringify(l.d), n = l.d.log.length;
  let msg;
  try { msg = apply(l.d, a) } catch (e) { l.d = JSON.parse(snap); throw e }
  if (!QUIET.has(a.type)) {
    l.undo.push({ snap, label: l.d.log[n]?.msg ?? a.type });
    if (l.undo.length > 50) l.undo.shift();
  }
  commit(l);
  return msg;
}

// --- sharing with the other laptops ---

let busy = false, lastError: string | null = null;
export function syncStatus() {
  drives();
  const waiting = [...drives().values()].filter(l => l.rev !== l.pushed).length + st().gone.length;
  return { account: cloud.who(), waiting, error: lastError };
}
export async function signIn(username: string, password: string) { drives(); await cloud.signIn(username, password); await sync() }
export function signOut() { cloud.signOut() }

async function sync() {
  if (busy || !cloud.who()) return;
  busy = true;
  try {
    const m = drives(), s = st();
    // up: deletions, then every drive changed here since its last upload
    while (s.gone.length) { await cloud.erase(s.gone[0]); delete s.remote[s.gone[0]]; delete s.at[s.gone[0]]; s.gone.shift(); keepState() }
    for (const l of m.values()) if (l.rev !== l.pushed) {
      const rev = l.rev;
      const t = fs.statSync(path.join(DIR, `${l.d.id}.json`)).mtimeMs;
      s.remote[l.d.id] = await cloud.upload(l.d);
      s.at[l.d.id] = t;
      l.pushed = rev; // a change made during the upload keeps it waiting for the next round
      keepState();
    }
    // down: whatever changed elsewhere since this laptop last saw it
    const all = await cloud.changes(), there = new Set(all.map(r => r.id));
    // deleted on another laptop: a drive this laptop had in the shared copy is no longer there (to this laptop's trash too;
    // unless it changed here meanwhile, then it goes back up)
    for (const l of [...m.values()]) if (l.d.id in s.remote && !there.has(l.d.id) && l.rev === l.pushed) {
      delete s.remote[l.d.id]; delete s.at[l.d.id];
      trash(l.d.id);
    }
    const fresh = all.filter(r => s.remote[r.id] !== r.updated_at);
    for (const r of fresh.length ? await cloud.fetchDrives(fresh.map(r => r.id)) : []) {
      const l = m.get(r.id);
      // ponytail: a drive changed here and elsewhere at once keeps this laptop's version (it goes up next round);
      // the live-drive lock makes that rare. Merge per student if it ever bites.
      if (l && l.rev !== l.pushed) continue;
      const d = migrate(r.data);
      d.id = r.id;
      save(d);
      s.at[d.id] = fs.statSync(path.join(DIR, `${d.id}.json`)).mtimeMs;
      if (l) { l.d = d; l.undo = [] }
      else m.set(d.id, { d, undo: [], subs: new Set(), rev: 0, pushed: 0 });
      s.remote[r.id] = r.updated_at;
    }
    if (fresh.length) tellAll();
    keepState();
    lastError = null;
  } catch (e) {
    lastError = (e as Error).message;
  } finally {
    busy = false;
  }
}
