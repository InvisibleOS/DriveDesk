// Server-side source of truth: every drive in memory, one file each in data/drives/, changes pushed to open screens.
// Every few seconds drives changed here go up to the committee's shared copy (lib/cloud.ts) and drives changed on
// other laptops come down; offline, changes simply wait. Who may change what follows the signed-in member's role
// (lib/drive.ts Role); the shared copy's own rules enforce the same.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cloud from './cloud';
import { alsoIn, apply, lead, migrate, newDrive, phasesOf, phaseStates, placedAll, planDrive, QUIET, shortOf, titleOf, refuse, runs, summary, type Action, type Ask, type Drive, type DriveConfig, type Member, type PhaseId, type Placed, type Plan, type Role } from './drive';

const DATA = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DIR = path.join(DATA, 'drives'), TRASH = path.join(DATA, 'trash'), STATE = path.join(DATA, 'sync.json'), PEOPLE = path.join(DATA, 'members.json'), SHEET = path.join(DATA, 'placed.json');
// rev counts changes made here, pushed is the rev last uploaded: they differ while a change waits to go up
type Live = { d: Drive; undo: { snap: string; label: string }[]; subs: Set<(payload: string) => void>; rev: number; pushed: number };
// remote: each drive's updated_at as last seen in the shared copy; at: its file's time when last uploaded or downloaded
// (a later file time means a change still has to go up, even after a restart); gone: deletions not uploaded yet
type SyncState = { device: string; remote: Record<string, string>; at: Record<string, number>; gone: string[] };

// this laptop, for "being run on …": the computer's name tells two laptops of one account apart
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
  try { members = JSON.parse(fs.readFileSync(PEOPLE, 'utf8')) } catch { members = [] } // volunteers' names, offline too
  try { sheet = JSON.parse(fs.readFileSync(SHEET, 'utf8')) } catch { sheet = [] }
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
// The desk itself opens only once someone has signed in on this laptop.
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

// --- who is signed in, and what they may do ---
// members: everyone with an account (names for volunteers); asks: volunteer requests, a junior's own or, for seniors, all
let members: Member[] = [], asks: Ask[] = [];
let sheet: Placed[] = []; // students placed before DriveDesk, kept here for offline use too
export const me = () => { drives(); return cloud.me() };
// a sign-in saved before roles is refreshed on the first request, so the page shows the right buttons from the start
export async function ready() { drives(); try { await cloud.token() } catch { /* offline: as saved */ } }
// fresh: straight from the shared copy (the Accounts page); otherwise as last synced
export async function people(fresh = false) { await ready(); if (fresh) await refresh(true); return { me: cloud.me(), members } }
// every placed student: the list from before DriveDesk, then everyone selected in a drive
export async function placed() { await ready(); return placedAll(sheet, [...drives().values()].map(l => l.d)) }
const nameOf = (user: string) => members.find(m => m.user === user)?.name ?? user;
// the requests still waiting for a senior, with what they are for: newest first
export function openAsks() {
  return asks.flatMap(a => {
    const d = get(a.drive)?.d, p = d && phasesOf(d).find(x => x.id === a.k);
    return a.status === 'pending' && d && p && !p.crew.includes(a.user) ? [{ ...a, name: nameOf(a.user), company: d.company, phase: titleOf(d, p), when: p.at }] : [];
  }).sort((a, b) => b.at - a.at);
}
export const asksFor = (id?: string) => asks.filter(a => !id || a.drive === id);

// who else is running this live drive right now, if anyone: changes are refused here until someone takes over
const heldBy = (d: Drive) => d.status === 'live' && d.host && d.host.device !== st().device && Date.now() - d.host.at < HOLD ? d.host.name : null;
// also: this drive's present students who are present in another live drive too, and what they are doing there
const liveDrives = () => [...drives().values()].filter(o => o.d.status === 'live').map(o => o.d);
// can: the phases the person signed in here runs (a senior every one, a junior those they volunteer at)
export const payload = (l: Live) => JSON.stringify({ drive: l.d, undo: l.undo.at(-1)?.label ?? null, held: heldBy(l.d), also: alsoIn(l.d, liveDrives()),
  me: cloud.me(), can: runs(l.d, cloud.me()), asks: asksFor(l.d.id), now: Date.now() });
// a change to one drive can change what the other open drives show about shared students
const tell = (l: Live) => { const p = payload(l); l.subs.forEach(send => send(p)) };
const tellAll = () => { for (const l of drives().values()) if (l.subs.size) tell(l) };

export function create(c: DriveConfig & { plan?: Plan }) {
  if (!lead(me())) throw Error('Only senior members can create drives');
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
  if (!lead(cloud.me())) throw Error('Only senior members can delete drives');
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
  const no = refuse(l.d, cloud.me(), a); // a junior runs only the phases they volunteer at
  if (no) throw Error(no);
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
  return { account: cloud.me()?.name ?? null, waiting, error: lastError };
}
export async function signIn(username: string, password: string) { drives(); await cloud.signIn(username, password); await sync() }
export function signOut() { cloud.signOut(); asks = [] }

// --- volunteering ---
// A member asks to volunteer at a phase that hasn't begun; a senior approves (they join its volunteers, which also lets
// them run the drive) or declines. Needs the internet: requests live only in the shared copy.
export async function volunteer(id: string, k: PhaseId, what: 'ask' | 'withdraw' | 'approve' | 'deny', user?: string) {
  const l = get(id), m = me();
  if (!l) throw Error('Drive not found');
  if (!m) throw Error('Signed out');
  const ph = phasesOf(l.d), i = ph.findIndex(p => p.id === k), label = i < 0 ? '' : shortOf(l.d, ph[i]);
  if (i < 0) throw Error('Phase not found');
  let msg: string;
  if (what === 'ask') {
    if (ph[i].crew.includes(m.user)) throw Error(`You already volunteer at the ${label}`);
    if (l.d.status === 'done' || phaseStates(l.d, Date.now())[i] === 'Done') throw Error(`The ${label} is over`);
    await cloud.ask(id, k);
    msg = `Asked to volunteer at the ${label}. A senior member will approve it`;
  } else if (what === 'withdraw') {
    await cloud.withdraw(id, k);
    msg = 'Request withdrawn';
  } else {
    if (!lead(m)) throw Error('Only senior members can approve volunteers');
    const a = asks.find(x => x.drive === id && x.k === k && x.user === user);
    if (!a) throw Error('That request is no longer there');
    if (what === 'approve') { // on the volunteers first: that is what lets them run it, even if marking the request fails
      dispatch(id, { type: 'plan', plan: { kind: l.d.kind ?? 'P', phases: ph.map(p => p.id === k ? { ...p, crew: [...new Set([...p.crew, a.user])] } : p) } });
      await cloud.decide(id, k, a.id, 'approved').catch(() => {});
      msg = `${nameOf(a.user)} is volunteering at the ${label}`;
    } else {
      await cloud.decide(id, k, a.id, 'denied');
      msg = `Declined ${nameOf(a.user)}\u2019s request`;
    }
  }
  await refresh(true);
  return msg;
}

// --- accounts (the admin's Accounts page) ---
// a new password is made here and shown to the admin once: 4 groups of 4, without look-alike characters
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const newPassword = () => Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => ALPHA[crypto.randomInt(ALPHA.length)]).join('')).join('-');
export async function account(a: { type: 'add'; name: string; user: string; role: Role } | { type: 'reset' | 'remove'; id: string }) {
  if (me()?.role !== 'admin') throw Error('Only the admin account manages accounts');
  let password: string | undefined;
  if (a.type === 'remove') await cloud.removeMember(a.id);
  else if (a.type === 'reset') await cloud.setPassword(a.id, password = newPassword());
  else if (a.type === 'add') await cloud.addMember(String(a.user ?? '').trim().toLowerCase(), String(a.name ?? '').trim(), a.role === 'senior' ? 'senior' : 'junior', password = newPassword());
  await refresh(true);
  return { password };
}

// requests every round, the members list every minute (or right after a change); open drives hear about new requests
let round = 0;
async function refresh(all = round % 12 === 0) {
  const before = JSON.stringify(asks);
  asks = await cloud.asks();
  if (all || !members.length) {
    members = await cloud.members();
    fs.writeFileSync(PEOPLE, JSON.stringify(members.map(({ user, name, role }) => ({ user, name, role }))));
    sheet = await cloud.placed().catch(() => sheet); // a laptop on an older shared copy, without the list, keeps what it has
    fs.writeFileSync(SHEET, JSON.stringify(sheet));
  }
  if (JSON.stringify(asks) !== before) tellAll();
}

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
      try { s.remote[l.d.id] = await cloud.upload(l.d) }
      catch (e) { // not theirs to change (no longer a volunteer): the shared copy's version comes down instead
        if ((e as { status?: number }).status !== 403) throw e;
        delete s.remote[l.d.id];
      }
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
    await refresh();
    round++;
    lastError = null;
  } catch (e) {
    lastError = (e as Error).message;
  } finally {
    busy = false;
  }
}
