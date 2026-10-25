// Drive engine: each placement drive is one JSON document, changed only through apply().
// Runs on the server; the client imports the read-only helpers.
//
// Model: each student carries how many rounds they have finished (`done`). After an interview they are
// "awaiting result" (pending); once marked "moved on" they are ready to call (waiting), and calling them
// sends them into a cabin for their next round automatically (round index = done).

export type Campus = 'BLR' | 'MPL' | '';
export type Status = 'waiting' | 'in' | 'pending' | 'selected' | 'rejected' | 'absent';
export type Result = 'done' | 'reject' | 'no-show' | 'moved';
export type Hist = { r: number; room: string; call: number; in?: number; out?: number; res?: Result };
export type Student = { id: string; reg: string; name: string; campus: Campus; done: number; status: Status; t: number; room: string | null; hist: Hist[]; reason?: string }; // reason: why absent
// name is always "Cabin <n>" by position; panel is the interviewer's name; rounds are the indices of the rounds this cabin takes
export type Room = { id: string; name: string; panel: string; rounds: number[] };
export type Drive = {
  v: number; id: string; company: string; date: string; location: string; status: 'planned' | 'live' | 'done'; startedAt: number; endedAt?: number; attendance?: number; // when attendance was taken; interviews start after it
  roll?: Record<string, string>; // attendance in progress: id → reason, for each student marked absent so far
  rounds: string[]; rooms: Room[]; students: Student[]; log: { t: number; msg: string }[]; seq: number;
  host?: { device: string; name: string; at: number }; // the laptop running this live drive, as of its last change there
};
export type Row = { reg: string; name: string; campus: Campus }; // reg: 9-digit registration number, the student's key ('' if unknown)
export type DriveConfig = { company: string; date: string; location: string; rounds: string[]; rooms: { panel?: string; rounds: number[] }[]; students: Row[] };

export type Action =
  | { type: 'call'; id: string; room: string }
  | { type: 'out'; id: string }
  | { type: 'move'; id: string; to: 'waiting' | 'pending' | 'selected' | 'rejected' | 'absent' }
  | { type: 'setDone'; id: string; n: number }
  | { type: 'setCampus'; id: string; campus: Campus }
  | { type: 'roomRounds'; room: string; rounds: number[] }
  | { type: 'editRoom'; room: string; name?: string; panel?: string }
  | { type: 'setRooms'; n: number }
  | { type: 'addRoom' }
  | { type: 'delRoom'; room: string }
  | { type: 'company'; name: string }
  | { type: 'date'; date: string }
  | { type: 'location'; location: string }
  | { type: 'renameRound'; i: number; name: string }
  | { type: 'addRound' }
  | { type: 'delRound' }
  | { type: 'addStudents'; rows: Row[] }
  | { type: 'clearStudents' }
  | { type: 'setup'; config: DriveConfig }
  | { type: 'roll'; id?: string; absent?: boolean; reason?: string } // without id: attendance has started
  | { type: 'attendance' }
  | { type: 'reason'; id: string; reason: string } // why an absent student is absent
  | { type: 'finish' }
  | { type: 'reopen' };

// text edits: saved, but not worth an undo step
export const QUIET = new Set(['company', 'renameRound', 'editRoom', 'roll', 'reason']);

export const LABEL: Record<Status, string> = { waiting: 'Ready to call', in: 'In cabin', pending: 'Awaiting result', selected: 'Selected', rejected: 'Rejected', absent: 'Absent' };
export const RES: Record<Result, string> = { done: 'Done', reject: 'Rejected', 'no-show': 'No show', moved: 'Moved' };

export const LOCATIONS = ['AB5 near PCOM Office', 'J Block Interview Cabins'];

export const allRounds = (n: number) => [...Array(n).keys()];
const pad = (n: number) => String(n).padStart(2, '0');
export const localDate = (t: number) => { const z = new Date(t); return `${z.getFullYear()}-${pad(z.getMonth() + 1)}-${pad(z.getDate())}` };
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
export const regOf = (v: unknown) => { const s = String(v ?? '').trim().replace(/\.0+$/, '').replace(/[\s-]/g, ''); return /^\d{9}$/.test(s) ? s : '' };
export const campusOf = (v: unknown): Campus => {
  const s = String(v ?? '').toLowerCase();
  return /\bblr\b|bangalore|bengaluru/.test(s) ? 'BLR' : /\bmpl\b|manipal/.test(s) ? 'MPL' : '';
};

export const fresh = (): Drive => ({ v: 9, id: '', company: '', date: '', location: '', status: 'live', startedAt: 0, rounds: ['Round 1'], rooms: [], students: [], log: [], seq: 1 });
export const occ = (d: Drive, r: Room) => d.students.find(s => s.room === r.id && s.status === 'in');
export const waiting = (d: Drive) => d.students.filter(s => s.status === 'waiting').sort((a, b) => a.t - b.t);
export const rname = (d: Drive, i: number) => d.rounds[i] || `Round ${i + 1}`;
export const doneLabel = (d: Drive, n: number) => n ? `${rname(d, n - 1)} done` : 'Not interviewed yet';
export function statusLabel(d: Drive, s: Student) {
  const prev = s.done ? rname(d, s.done - 1) : '';
  if (s.status === 'waiting') return prev ? `Moved on to ${rname(d, s.done)}` : 'Not interviewed yet';
  if (s.status === 'pending' && prev) return `Awaiting ${prev} result`;
  if (s.status === 'rejected' && prev) return `Rejected after ${prev}`;
  return LABEL[s.status];
}
// A student present in another live drive at the same time (same registration number): what they are doing there and
// since when, so both desks can coordinate. Absent students and drives that aren't running don't count.
export type Also = { company: string; status: string; busy: boolean; at: number }; // busy: in a cabin there right now
const present = (d: Drive, s: Student) => d.status === 'live' && s.status !== 'absent' && !(d.roll && s.id in d.roll); // roll: marked absent during roll call
export function alsoIn(d: Drive, others: Drive[]): Record<string, Also[]> {
  const mine = new Map(d.students.filter(s => s.reg && present(d, s)).map(s => [s.reg, s.id]));
  const out: Record<string, Also[]> = {};
  for (const o of others) if (o.id !== d.id) for (const s of o.students) {
    const id = s.reg && present(o, s) && mine.get(s.reg);
    if (!id) continue;
    const h = last(s);
    (out[id] ??= []).push({
      company: o.company,
      status: s.status === 'in' && h ? `In ${h.room} for ${rname(o, h.r)}` : statusLabel(o, s),
      busy: s.status === 'in',
      at: Math.max(s.t, h?.out ?? h?.in ?? 0),
    });
  }
  return out;
}

// Students already selected in a drive, by registration number: a new drive leaves them out unless the desk keeps them.
export type Placed = Record<string, { company: string; date: string }>;
export function placedIn(drives: Drive[]): Placed {
  const out: Placed = {};
  for (const d of [...drives].sort((a, b) => a.date.localeCompare(b.date))) // the first offer is the one that counts
    for (const s of d.students) if (s.reg && s.status === 'selected') out[s.reg] ??= { company: d.company, date: d.date };
  return out;
}

export const fits = (r: Room, s: Student) => r.rounds.includes(s.done);
// a free cabin that takes this round; when there is none, nobody can be called for it
export const roundOpen = (d: Drive, i: number) => d.rooms.some(r => r.rounds.includes(i) && !occ(d, r));
export const roundsLabel = (d: Drive, r: Room) => r.rounds.length >= d.rounds.length ? 'All rounds' : r.rounds.map(i => `R${i + 1}`).join(' · ');
export const last = (s: Student): Hist | undefined => s.hist[s.hist.length - 1];
// valid, sorted, de-duplicated round indices
const cleanRounds = (x: unknown, n: number) =>
  [...new Set((Array.isArray(x) ? x : []).map(Number).filter(i => Number.isInteger(i) && i >= 0 && i < n))].sort((a, b) => a - b);

// Upgrades saves from earlier versions: v1 (queues: round + queued/pending), v2 (no pending status),
// v3 (cabins could be paused), v4 (separate "called" step), v5 (one drive only, single round per cabin, no campus), v6 (no location), v7 (no attendance step), v8 (no registration numbers).
export function migrate(d: any): Drive { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (d.v === 9) return d;
  if ((d.v ?? 0) < 5) {
    for (const r of d.rooms) delete r.paused;
    const v2 = !d.v && d.students.every((s: object) => !('round' in s));
    if (!d.v) for (const s of d.students) {
      if ('round' in s) { s.done = s.round + (s.status === 'pending' || s.status === 'selected' ? 1 : 0); delete s.round }
      if (s.status === 'queued') s.status = 'waiting';
      if (v2 && s.status === 'waiting' && last(s)?.res === 'done') s.status = 'pending'; // v2 had no separate "awaiting result"
      for (const h of s.hist) if (h.res === 'next' || h.res === 'later') h.res = 'done';
    }
    for (const s of d.students) if (s.status === 'called') { const h = last(s); s.status = 'in'; if (h) h.in ??= h.call }
    delete d.auto;
  }
  const first = d.log?.[0]?.t ?? Date.now();
  Object.assign(d, { id: d.id ?? '', date: d.date ?? localDate(first), status: d.status ?? 'live', startedAt: d.startedAt ?? first });
  for (const r of d.rooms) if (!Array.isArray(r.rounds)) { r.rounds = r.round == null ? allRounds(d.rounds.length) : [r.round]; delete r.round }
  for (const s of d.students) { s.campus ??= ''; s.reg ??= '' }
  d.location ??= '';
  if (d.status !== 'planned') d.attendance ??= d.startedAt; // drives from before the attendance step carry on as they were
  d.v = 9;
  return d;
}

// CSV / TSV / pasted text → table of cells. Handles quoted cells and Excel's BOM.
export function toTable(text: string): string[][] {
  return text.replace(/^﻿/, '').split(/\r?\n/).map(l => {
    if (l.includes('\t')) return l.split('\t');
    const o: string[] = []; let c = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (ch === '"') { if (q && l[i + 1] === '"') { c += '"'; i++ } else q = !q }
      else if (ch === ',' && !q) { o.push(c); c = '' }
      else c += ch;
    }
    return [...o, c];
  });
}

// Keeps only each student's registration number, name and campus. The header row is optional: the columns are
// found by their headings; without one, the registration column is the one holding 9-digit numbers, the campus
// column the one holding BLR / MPL values, and the name the first other column.
export function parseStudents(table: string[][]): Row[] {
  const rows = table.map(r => r.map(c => String(c ?? '').trim())).filter(r => r.some(Boolean));
  if (!rows.length) return [];
  const word = (w: string) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`, 'i');
  const REG = /\breg|registration|\broll|enrol|\busn\b/i;
  const head = rows[0], hasHead = head.some(c => word('name').test(c) || /campus/i.test(c) || REG.test(c));
  const body = hasHead ? rows.slice(1) : rows;
  const col = (re: RegExp, not?: RegExp) => hasHead ? head.findIndex(c => re.test(c) && !not?.test(c)) : -1;
  const first = col(/first\s*name|given\s*name/i), lastName = col(/last\s*name|surname|family\s*name/i);
  const width = Math.max(...body.map(r => r.length));
  const mostly = (i: number, ok: (v: string) => unknown) => { const v = body.map(r => r[i]).filter(Boolean); return v.length > 0 && v.filter(ok).length >= v.length / 2 };
  let reg = col(REG);
  if (reg < 0) reg = allRounds(width).find(i => mostly(i, regOf)) ?? -1;
  let campus = col(/campus|location|city|cent(re|er)/i);
  let name = col(word('name'), /father|mother|parent|guardian|college|company|school|user|file|course|branch|first|last|given|family|sur/i);
  if (name < 0 && first < 0) name = allRounds(width).find(i => i !== reg && i !== campus && !mostly(i, campusOf)) ?? 0;
  if (campus < 0) campus = allRounds(width).find(i => i !== name && i !== reg && mostly(i, campusOf)) ?? -1;
  return body.map(r => ({
    reg: reg >= 0 ? regOf(r[reg]) : '',
    name: (name >= 0 ? r[name] ?? '' : [r[first], r[lastName]].filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim().slice(0, 120),
    campus: campus >= 0 ? campusOf(r[campus]) : '' as Campus,
  })).filter(x => x.name);
}

// A drive booked for a later day: only the company and date. Rounds, cabins and students are added on the day ('setup').
export function planDrive(c: { company: string; date: string; location: string }, id: string, t = Date.now()): Drive {
  const company = String(c?.company ?? '').trim().slice(0, 80);
  if (!company) throw Error('Enter the company name');
  if (!isDate(c.date)) throw Error('Pick a valid date');
  if (!LOCATIONS.includes(c.location)) throw Error('Pick the location');
  return { ...fresh(), id, company, date: c.date, location: c.location, status: 'planned', startedAt: t, log: [{ t, msg: `Drive created for ${c.date}` }] };
}

// Builds a new drive from the onboarding answers; throws a readable message when something is missing.
export function newDrive(c: DriveConfig, id: string, t = Date.now()): Drive {
  const { company, location } = planDrive(c, id, t);
  const rounds = (Array.isArray(c.rounds) ? c.rounds : []).slice(0, 10).map((n, i) => String(n ?? '').trim().slice(0, 40) || `Round ${i + 1}`);
  if (!rounds.length) throw Error('Add at least one round');
  const d: Drive = { ...fresh(), id, company, date: c.date, location, startedAt: t, rounds };
  for (const r of (Array.isArray(c.rooms) ? c.rooms : []).slice(0, 60)) {
    const takes = cleanRounds(r?.rounds, rounds.length);
    d.rooms.push({ id: String(d.seq++), name: `Cabin ${d.rooms.length + 1}`, panel: String(r?.panel ?? '').trim().slice(0, 60), rounds: takes.length ? takes : allRounds(rounds.length) });
  }
  if (!d.rooms.length) throw Error('Add at least one cabin');
  d.log.push({ t, msg: `Drive started: ${company}` });
  if (Array.isArray(c.students) && c.students.length) apply(d, { type: 'addStudents', rows: c.students }, t);
  return d;
}

// Small per-drive numbers for the dashboard and calendar.
export function summary(d: Drive) {
  const n = (f: (s: Student) => boolean) => d.students.filter(f).length;
  return {
    id: d.id, company: d.company, date: d.date, location: d.location, status: d.status, startedAt: d.startedAt, endedAt: d.endedAt,
    rounds: d.rounds.length, rooms: d.rooms.length, students: d.students.length,
    blr: n(s => s.campus === 'BLR'), mpl: n(s => s.campus === 'MPL'),
    inCabin: n(s => s.status === 'in'), awaiting: n(s => s.status === 'pending'),
    attendance: !!d.attendance, selected: n(s => s.status === 'selected'), blrSelected: n(s => s.status === 'selected' && s.campus === 'BLR'), rejected: n(s => s.status === 'rejected'),
  };
}
export type Summary = ReturnType<typeof summary>;

// Who to call next: the first students in each round's line, as many as that round has free cabins right now.
export function upNext(d: Drive) {
  const free = d.rounds.map((_, i) => d.rooms.filter(r => r.rounds.includes(i) && !occ(d, r)).length), seen: number[] = [];
  return new Set(waiting(d).filter(s => (seen[s.done] = (seen[s.done] ?? 0) + 1) <= (free[s.done] ?? 0)).map(s => s.id));
}

// Rough timing for a live drive, from how it has gone so far: wait = ms until each ready student is likely called,
// done = when the last interview likely ends. Plays the rest of the drive forward: each cabin takes the earliest
// student it can, every interview lasts its round's average (call to out), and of the students finishing a round only
// that round's share who cleared it so far go on to the next. Nothing until the first interview has finished.
// ponytail: averages and pass rates only; weight recent interviews if early ones skew it.
export function forecast(d: Drive, now: number): { wait: Record<string, number>; done: number } | null {
  const L = d.rounds.length, held = d.students.flatMap(s => s.hist).filter(h => h.res === 'done' && h.out);
  if (!held.length) return null;
  const mean = (h: Hist[]) => h.reduce((a, x) => a + x.out! - x.call, 0) / h.length;
  const all = mean(held), len = d.rounds.map((_, i) => { const h = held.filter(x => x.r === i); return h.length ? mean(h) : all });
  // pass rate per round, nudged towards half while there are few results: (cleared + 1) / (decided + 2)
  const pass = d.rounds.map((_, i) => {
    const ok = d.students.filter(s => s.done > i + 1 || (s.done === i + 1 && ['waiting', 'in', 'selected'].includes(s.status))).length;
    const no = d.students.filter(s => s.status === 'rejected' && s.done === i + 1).length;
    return (ok + 1) / (ok + no + 2);
  });
  const acc = d.rounds.map(() => .5); // goes on to the next round when a round's running share reaches a whole student
  const goesOn = (k: number) => k + 1 < L && (acc[k] += pass[k]) >= 1 && (acc[k] -= 1, true);
  type Job = { id: string; k: number; ready: number; first: boolean };
  // the ready line first: students who clear a round later join the back of the next queue
  const jobs: Job[] = waiting(d).filter(s => s.done < L).map(s => ({ id: s.id, k: s.done, ready: now, first: true }));
  const free = new Map(d.rooms.map(r => [r.id, now]));
  let done = now;
  for (const s of d.students) {
    if (s.status === 'in' && s.room) {
      const end = Math.max(now, last(s)!.call + len[s.done]);
      free.set(s.room, end); done = Math.max(done, end);
      if (goesOn(s.done)) jobs.push({ id: s.id, k: s.done + 1, ready: end, first: false });
    } else if (s.status === 'pending' && goesOn(s.done - 1)) jobs.push({ id: s.id, k: s.done, ready: now, first: false });
  }
  const wait: Record<string, number> = {};
  while (jobs.length) {
    const j = jobs.reduce((a, b) => b.ready < a.ready ? b : a); // earliest ready; ties keep queue order
    jobs.splice(jobs.indexOf(j), 1);
    const room = d.rooms.filter(r => r.rounds.includes(j.k)).sort((a, b) => free.get(a.id)! - free.get(b.id)!)[0];
    if (!room) continue; // no cabin takes this round
    const start = Math.max(j.ready, free.get(room.id)!), end = start + len[j.k];
    if (j.first) wait[j.id] = start - now;
    free.set(room.id, end); done = Math.max(done, end);
    if (goesOn(j.k)) jobs.push({ id: j.id, k: j.k + 1, ready: end, first: false });
  }
  return { wait, done };
}

// Applies one action to d in place. Throws on invalid input (caller rolls back). Returns an optional message for the user.
export function apply(d: Drive, a: Action, t = Date.now()): string | undefined {
  const st = (id: string) => { const s = d.students.find(s => s.id === id); if (!s) throw Error('Student not found'); return s };
  const rm = (id: string) => { const r = d.rooms.find(r => r.id === id); if (!r) throw Error('Cabin not found'); return r };
  const log = (msg: string) => { d.log.push({ t, msg }) };
  const newRoom = (name: string): Room => ({ id: String(d.seq++), name, panel: '', rounds: allRounds(d.rounds.length) });

  if (d.status === 'planned' && !['company', 'date', 'location', 'setup'].includes(a.type)) throw Error('Set up this drive first');
  let msg: string | undefined;
  switch (a.type) {
    case 'call': {
      if (!d.attendance) throw Error('Take attendance first');
      const s = st(a.id), r = rm(a.room);
      if (occ(d, r)) throw Error(`${r.name} is not free`);
      if (!fits(r, s)) throw Error(`${r.name} doesn't take ${rname(d, s.done)}`);
      if (s.status !== 'waiting' && s.status !== 'absent') throw Error(`${s.name} is ${LABEL[s.status].toLowerCase()}`);
      if (s.done >= d.rounds.length) throw Error(`${s.name} has finished every round`);
      // calling = sent into the cabin; the interview starts now
      Object.assign(s, { status: 'in', room: r.id, t });
      s.hist.push({ r: s.done, room: r.name, call: t, in: t });
      log(`${s.name} → ${r.name} (${rname(d, s.done)})`);
      break;
    }
    case 'out': {
      const s = st(a.id); if (s.status !== 'in') throw Error(`${s.name} is not in a cabin`);
      const h = last(s)!;
      Object.assign(h, { out: t, res: 'done' });
      Object.assign(s, { done: h.r + 1, room: null, t, status: 'pending' });
      log(`${s.name} finished ${rname(d, h.r)} in ${h.room} · awaiting result`);
      break;
    }
    case 'move': {
      const s = st(a.id), h = last(s);
      if (!(a.to in LABEL) || a.to === ('in' as string)) throw Error('Unknown status');
      if (h && !h.out && s.status === 'in') { h.out = t; h.res = 'moved' }
      if (a.to !== 'absent') delete s.reason;
      Object.assign(s, { room: null, t, status: a.to });
      log(`${s.name}: ${statusLabel(d, s)}`);
      break;
    }
    case 'setDone': {
      const s = st(a.id); if (s.status === 'in') throw Error(`${s.name} is in a cabin right now`);
      s.done = Math.min(Math.max(0, a.n | 0), d.rounds.length);
      log(`${s.name} set to ${doneLabel(d, s.done)}`);
      break;
    }
    case 'setCampus': { const s = st(a.id); s.campus = campusOf(a.campus); log(`${s.name}: campus ${s.campus || 'cleared'}`); break }
    case 'roomRounds': {
      const r = rm(a.room), takes = cleanRounds(a.rounds, d.rounds.length);
      if (!takes.length) throw Error(`${r.name} needs at least one round`);
      r.rounds = takes;
      log(`${r.name} takes ${roundsLabel(d, r)}`);
      break;
    }
    case 'editRoom': { const r = rm(a.room); if (a.name != null) r.name = String(a.name).slice(0, 40); if (a.panel != null) r.panel = String(a.panel).slice(0, 60); break }
    case 'setRooms': {
      const n = Math.max(1, Math.min(60, a.n | 0));
      while (d.rooms.length < n) d.rooms.push(newRoom(`Cabin ${d.rooms.length + 1}`));
      while (d.rooms.length > n && !occ(d, d.rooms[d.rooms.length - 1])) d.rooms.pop();
      log(`${d.rooms.length} cabins`); break;
    }
    case 'addRoom': d.rooms.push(newRoom(`Cabin ${d.rooms.length + 1}`)); log('Cabin added'); break;
    case 'delRoom': { const r = rm(a.room); if (occ(d, r)) throw Error(`${r.name} has a student in it`); d.rooms = d.rooms.filter(x => x !== r); log(`${r.name} removed`); break }
    case 'company': d.company = String(a.name).trim().slice(0, 80) || d.company; break;
    case 'date': if (!isDate(a.date)) throw Error('Pick a valid date'); d.date = a.date; log(`Date set to ${a.date}`); break;
    case 'location': if (!LOCATIONS.includes(a.location)) throw Error('Pick the location'); d.location = a.location; log(`Location: ${a.location}`); break;
    case 'renameRound': if (d.rounds[a.i] != null) d.rounds[a.i] = String(a.name).slice(0, 40); break;
    case 'addRound': {
      const n = d.rounds.length;
      if (n >= 10) throw Error('Up to 10 rounds');
      d.rounds.push(`Round ${n + 1}`);
      d.rooms.forEach(r => { if (r.rounds.length === n) r.rounds.push(n) }); // cabins that took every round take the new one too
      log('Round added'); break;
    }
    case 'delRound': {
      const L = d.rounds.length - 1; if (L < 1) throw Error('At least one round is needed');
      if (d.students.some(s => s.done > L || s.hist.some(h => h.r === L))) throw Error('Students have already reached that round');
      d.rounds.pop();
      d.rooms.forEach(r => { r.rounds = r.rounds.filter(i => i < L); if (!r.rounds.length) r.rounds = allRounds(L) });
      log('Last round removed'); break;
    }
    case 'addStudents': {
      if (!Array.isArray(a.rows)) throw Error('No students given');
      const key = (x: Row) => x.reg || `${x.name.toLowerCase()}|${x.campus}`; // the registration number identifies a student
      const have = new Set(d.students.map(key)); let n = 0, dup = 0;
      for (const raw of a.rows.slice(0, 5000)) {
        const x: Row = { reg: regOf(raw?.reg), name: String(raw?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120), campus: campusOf(raw?.campus) };
        if (!x.name) continue;
        if (have.has(key(x))) { dup++; continue }
        have.add(key(x));
        d.students.push({ id: String(d.seq++), ...x, done: 0, status: 'waiting', t: t + n++, room: null, hist: [] });
      }
      if (!n && !dup) throw Error('No names found');
      log(`Added ${n} student${n === 1 ? '' : 's'}`);
      msg = `Added ${n} student${n === 1 ? '' : 's'}${dup ? ` · skipped ${dup} already on the list` : ''}`;
      break;
    }
    case 'clearStudents': if (d.students.some(s => s.status === 'in')) throw Error('Someone is still in a cabin'); d.students = []; log('All students removed'); break;
    case 'setup': {
      if (d.status !== 'planned') throw Error('This drive is already set up');
      const n = newDrive(a.config, d.id, t);
      Object.assign(d, n, { log: [...d.log, ...n.log] });
      break;
    }
    case 'roll': { // saved as it is taken, so a refresh or a second device carries on from the same place
      if (d.attendance) throw Error('Attendance has already been taken');
      const roll = d.roll ??= {};
      if (a.id != null) {
        st(a.id);
        if (a.absent) roll[a.id] = String(a.reason ?? roll[a.id] ?? '').slice(0, 200);
        else delete roll[a.id];
      }
      break;
    }
    case 'attendance': {
      if (d.attendance) throw Error('Attendance has already been taken');
      let off = 0;
      for (const [id, why] of Object.entries(d.roll ?? {})) {
        const s = d.students.find(s => s.id === id), reason = why.trim();
        if (s?.status !== 'waiting') continue;
        Object.assign(s, { status: 'absent', t }, reason && { reason });
        off++;
      }
      delete d.roll;
      d.attendance = t;
      log(`Attendance taken: ${d.students.length - off} present, ${off} absent`);
      break;
    }
    case 'reason': {
      const s = st(a.id), why = String(a.reason ?? '').trim().slice(0, 200);
      if (s.status !== 'absent') throw Error(`${s.name} is not marked absent`);
      if (why) s.reason = why; else delete s.reason;
      break;
    }
    case 'finish': {
      const busy = d.students.filter(s => s.status === 'in').length;
      if (busy) throw Error(`${busy} student${busy > 1 ? 's are' : ' is'} still in a cabin. Mark them as exited first`);
      d.status = 'done'; d.endedAt = t; log('Drive ended'); break;
    }
    case 'reopen': d.status = 'live'; delete d.endedAt; log('Drive reopened'); break;
    default: throw Error('Unknown action');
  }
  if (a.type === 'addRoom' || a.type === 'delRoom' || a.type === 'setRooms') d.rooms.forEach((r, i) => { r.name = `Cabin ${i + 1}` }); // keep the numbering 1..n
  return msg;
}
