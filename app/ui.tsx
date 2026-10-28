'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { lead, PHASES, statusLabel, type Action, type Also, type Ask, type Drive, type Member, type PhaseKey, type Summary } from '@/lib/drive';

let skew = 0; // server clock − this device's clock, so the display clock matches the desk
export const now = () => Date.now() + skew;
export const tm = (t?: number) => t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
export const longDate = (ds: string) => ds ? new Date(`${ds}T00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';
// '2026-10-26T10:00' → 'Mon, 26 Oct · 10:00'
export const when = (at: string) => {
  if (!at) return 'No date yet';
  const z = new Date(at.length > 10 ? at : `${at}T00:00`), day = z.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  return at.length > 10 ? `${day} · ${tm(z.getTime())}` : day;
};
// a person's initials in a small round badge
const initials = (n: string) => n.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
export const Av = ({ n }: { n: string }) => <i className="av" aria-hidden>{initials(n)}</i>;

export function toast(m: string, bad = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = m;
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}

// A closing dialog hands focus back to the button that opened it, which then shows its focus ring even after a
// mouse click. Call this just before opening one: it lets go of that focus unless the keyboard put it there.
export const letGo = () => { const el = document.activeElement as HTMLElement | null; if (el && !el.matches(':focus-visible')) el.blur() };

// A yes/no question in the app's own style (instead of the browser's confirm box). Resolves true for yes.
export function ask(title: string, body: string, yes: string, danger = false) {
  const d = document.createElement('dialog');
  d.className = 'ask';
  d.innerHTML = '<form method="dialog"><h3></h3><p></p><div class="row"><div class="sp"></div><button value="">Cancel</button><button value="yes"></button></div></form>';
  d.querySelector('h3')!.textContent = title;
  d.querySelector('p')!.textContent = body;
  const b = d.querySelector<HTMLButtonElement>('button[value=yes]')!;
  b.textContent = yes;
  b.className = danger ? 'danger' : 'primary';
  document.body.append(d);
  letGo();
  d.showModal();
  return new Promise<boolean>(res => d.addEventListener('close', () => { res(d.returnValue === 'yes'); d.remove() }));
}

export function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const getPin = () => { try { return localStorage.getItem('desk-pin') ?? '' } catch { return '' } };
export const withPin = (p: string) => `${p}${p.includes('?') ? '&' : '?'}pin=${encodeURIComponent(getPin())}`;

// sends JSON with the PIN; shows the server's error as a toast and throws, so callers can stop
export async function post<T = { msg?: string }>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  let r: Response;
  try { r = await fetch(withPin(path), { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }) }
  catch { toast('Not connected. Is the desk laptop on?', true); throw Error('offline') }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { toast(j.error || 'Something went wrong', true); throw Error(j.error) }
  return j;
}

// held: the other laptop running this drive; also: student id → where else they are present right now;
// me: who is signed in; can: the phases they run (a junior, those they volunteer at); asks: its volunteer requests
export type Seen = Record<string, Also[]>;
export type Live = { drive: Drive; undo: string | null; held: string | null; also: Seen; me: Member | null; can: Partial<Record<PhaseKey, boolean>>; asks: Ask[] };
export type Send = (a: Action | { type: 'undo' } | { type: 'takeOver' }) => Promise<void>;
type Gate = 'pin' | 'signin';
const gateOf = (r: Response) => r.json().then(j => (j.gate === 'signin' ? 'signin' : 'pin') as Gate, () => 'pin' as Gate);
const gateFor = (g: Gate | null) => g === 'pin' ? <PinGate /> : g === 'signin' ? <SignIn /> : null;

// Live connection to one drive: initial state, then every change pushed by the server.
export function useDrive(id: string) {
  const [x, setX] = useState<Live | null>(null);
  const [live, setLive] = useState(false);
  const [state, setState] = useState<'ok' | Gate | 'missing'>('ok');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let es: EventSource | undefined, dead = false;
    fetch(withPin(`/api/drives/${id}?once=1`)).then(async r => {
      if (dead) return;
      if (r.status === 401) return setState(await gateOf(r));
      if (r.status === 404) return setState('missing');
      es = new EventSource(withPin(`/api/drives/${id}`));
      es.onmessage = e => { const j = JSON.parse(e.data); skew = j.now - Date.now(); setX(j); setLive(true) };
      es.onerror = () => setLive(false); // EventSource reconnects by itself
    }).catch(() => { if (!dead) setTimeout(() => setAttempt(a => a + 1), 3000) });
    return () => { dead = true; es?.close() };
  }, [id, attempt]);

  const send: Send = useCallback(async a => {
    try { const j = await post(`/api/drives/${id}`, a); if (j.msg) toast(j.msg) } catch { /* already shown */ }
  }, [id]);

  const gate = state === 'pin' || state === 'signin' ? gateFor(state)
    : state === 'missing' ? <div className="emptyst"><Logo s={36} /><div><h2>Drive not found</h2><p className="meta">It may have been deleted.</p></div><div className="row"><a className="btn" href="/"><Icon n="left" />All drives</a></div></div>
    : !x ? <div className="loading">Loading drive…</div> : null;
  return { x, live, send, gate };
}

// Every drive's summary for the dashboard, with who is signed in and their volunteer requests.
export function useDrives() {
  const [list, setList] = useState<Summary[] | null>(null);
  const [mine, setMine] = useState<{ me: Member | null; asks: Ask[] }>({ me: null, asks: [] });
  const [gate, setGate] = useState<Gate | null>(null);
  useEffect(() => {
    const load = () => fetch(withPin('/api/drives'))
      .then(async r => r.status === 401 ? setGate(await gateOf(r))
        : r.ok ? r.json().then(j => { setList(j.drives); setMine({ me: j.me, asks: j.asks }) })
        : toast(`The desk hit a problem (error ${r.status}). Restart the app; if it keeps happening, send server.log from the app's data folder`, true))
      .catch(() => toast('Server not reachable', true));
    load();
    const i = setInterval(load, 15000); // drives made or changed on other laptops show up without a reload
    return () => clearInterval(i);
  }, []);
  return { list, ...mine, gate: gateFor(gate) ?? (!list ? <div className="loading">Loading…</div> : null) };
}

// Everyone with an account (volunteers' names, the Accounts page) and who is signed in here: one copy for the whole
// page, refreshed every minute; loadPeople(true) asks the shared copy straight away.
type People = { me: Member | null; members: Member[] };
let people: People | null = null, every: ReturnType<typeof setInterval> | undefined;
const heard = new Set<(p: People) => void>();
export const loadPeople = (fresh = false) => fetch(withPin(`/api/members${fresh ? '?fresh=1' : ''}`)).then(r => r.ok ? r.json() : null)
  .then((p: People | null) => { if (p?.members) { people = p; heard.forEach(f => f(p)) } }, () => {});
export function usePeople() {
  const [p, setP] = useState(people);
  useEffect(() => {
    heard.add(setP);
    if (!people) loadPeople();
    every ??= setInterval(loadPeople, 60e3);
    return () => { heard.delete(setP) };
  }, []);
  return p;
}
export const nameOf = (p: People | null, user: string) => p?.members.find(m => m.user === user)?.name ?? user;

// First screen on a laptop that hasn't signed in: the desk's name and tagline beside the sign-in with a member's own
// account, made by the admin on the Accounts page (it stays signed in after that).
function SignIn() {
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setErr('');
    try {
      const r = await fetch(withPin('/api/sync'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: f.get('username'), password: f.get('password') }) });
      if (r.ok) return location.reload();
      setErr((await r.json().catch(() => ({}))).error || 'Couldn’t sign in. Try again');
    } catch { setErr('No internet connection. Signing in needs it once; after that the desk works offline') }
    setBusy(false);
  };
  return (
    <div className="land">
      <section className="land-intro">
        <div className="land-brand"><Logo s={30} /><Wordmark /></div>
        <div className="land-copy">
          <h1>Placement drives, <em>without the chaos</em>.</h1>
          <p>Cabins, queues, attendance and results for the placement committee. Every laptop stays in sync, and nothing is lost if the Wi-Fi drops.</p>
        </div>
      </section>

      <section className="land-side">
        <form className="land-card" onSubmit={submit}>
          <div>
            <h2>Welcome back</h2>
            <p className="meta">Sign in with your DriveDesk account. This laptop stays signed in.</p>
          </div>
          <label className="lf"><span>Username</span>
            <input name="username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="e.g. riddhi" required autoFocus />
          </label>
          <label className="lf"><span>Password</span>
            <span className="pw">
              <input name="password" type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="••••••••" required />
              <button type="button" className="icon ghost sm" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} title={show ? 'Hide password' : 'Show password'}><Icon n={show ? 'eyeOff' : 'eye'} s={15} /></button>
            </span>
          </label>
          {err && <p className="land-err" role="alert">{err}</p>}
          <button className="primary" disabled={busy}>{busy ? 'Signing in…' : <>Sign in<Icon n="right" s={15} /></>}</button>
          <p className="land-help">No account yet? Ask your placement coordinator to add you.</p>
        </form>
      </section>
    </div>
  );
}

// Top-bar status of the shared copy: everything uploaded, changes on their way, or waiting for the internet.
// Clicking it offers to sign this laptop out.
function SyncStatus() {
  const [s, setS] = useState<{ account: string | null; waiting: number; error: string | null } | null>(null);
  useEffect(() => {
    const load = () => fetch(withPin('/api/sync')).then(r => r.ok ? r.json().then(setS) : null).catch(() => {});
    load();
    const i = setInterval(load, 5000);
    return () => clearInterval(i);
  }, []);
  if (!s?.account) return null;
  const [icon, tone, title, text]: [keyof typeof ICONS, string, string, string] = s.error
    ? ['cloudOff', 'warn', 'Offline', `${s.waiting ? `${s.waiting} change${s.waiting > 1 ? 's' : ''} waiting. ` : ''}Everything is saved on this laptop and uploads when the internet is back.`]
    : s.waiting ? ['cloudUp', '', 'Uploading…', 'Saving the latest changes to the committee’s shared copy.']
    : ['cloudOk', '', 'Synced', 'Every drive is saved to the committee’s shared copy.'];
  return <Pop label={title} icon={icon} tone={tone}><div className="pop-b"><b>{title}</b><p>{text}</p><small>Signed in as {s.account}</small></div></Pop>;
}

function PinGate() {
  return (
    <form className="emptyst" onSubmit={e => {
      e.preventDefault();
      try { localStorage.setItem('desk-pin', new FormData(e.currentTarget).get('pin') as string) } catch {}
      location.reload();
    }}>
      <Logo s={36} />
      <div><h2>Enter the desk PIN</h2><p className="meta">Ask the placement coordinator running the desk.</p></div>
      <div className="row"><input name="pin" type="password" inputMode="numeric" autoFocus aria-label="PIN" className="grow" /><button className="primary">Join</button></div>
    </form>
  );
}

export const useNow = () => {
  const [n, setN] = useState(now);
  useEffect(() => { const i = setInterval(() => setN(now()), 1000); return () => clearInterval(i) }, []);
  return n;
};

// light / dark theme, remembered in this browser (applied before paint by app/layout.tsx)
export function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.dataset.theme === 'dark'), []);
  const flip = () => {
    const t = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('theme', t) } catch { /* private window: lasts until reload */ }
    setDark(!dark);
  };
  return [dark, flip] as const;
}

// ⋯ button with a small menu; a click anywhere outside it closes it
function useOutside(open: boolean, setOpen: (o: boolean) => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) };
    addEventListener('pointerdown', close);
    return () => removeEventListener('pointerdown', close);
  }, [open, setOpen, ref]);
}

export function More({ label, items, className = 'icon ghost', down, dot, head, children }: { label: string; items: [React.ReactNode, () => void][]; className?: string; down?: boolean; dot?: boolean; head?: React.ReactNode; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useOutside(open, setOpen, ref);
  return (
    <span ref={ref} className={`kebab${open ? ' open' : ''}`}>
      <button className={className} title={label} aria-label={label} aria-expanded={open} onClick={e => { e.stopPropagation(); setOpen(!open) }}>{children ?? <Icon n="more" />}{dot && <i className="dot" />}</button>
      {open && <div className={`menu${down ? ' down' : ''}`} role="menu">
        {head}
        {items.map(([l, f], i) => <button key={i} role="menuitem" onClick={e => { e.stopPropagation(); setOpen(false); f() }}>{l}</button>)}
      </div>}
    </span>
  );
}

// A large dialog with a title, a count, the page's own buttons and ×; a click on the backdrop closes it.
// useSheet gives its ref and an opener that lets go of the button's focus first.
export function useSheet() {
  const ref = useRef<HTMLDialogElement>(null);
  return [ref, () => { letGo(); ref.current?.showModal() }] as const;
}
export const Sheet = ({ sheet, title, count, tools, className = '', onClose, children }: {
  sheet: React.RefObject<HTMLDialogElement | null>; title: React.ReactNode; count?: number; tools?: React.ReactNode; className?: string; onClose?: () => void; children: React.ReactNode;
}) => (
  <dialog ref={sheet} className={`sheet ${className}`} onClose={onClose} onClick={e => e.target === e.currentTarget && sheet.current?.close()}>
    <div className="sheet-h"><h2>{title}</h2>{count !== undefined && <span className="cnt">{count}</span>}<div className="sp" />{tools}
      <button className="icon ghost" onClick={() => sheet.current?.close()} aria-label="Close"><Icon n="x" /></button></div>
    {children}
  </dialog>
);

// The top of a page: an optional eyebrow, the serif title and a line of details; on the right, its numbers or buttons.
export const PageHead = ({ title, eyebrow, meta, children }: { title: React.ReactNode; eyebrow?: React.ReactNode; meta?: React.ReactNode; children?: React.ReactNode }) => (
  <div className="phead">
    <div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{meta}</div>
    {children}
  </div>
);

// One box in a numbers row (.stats): a label in its status colour, a big number and a small note. A button when it opens something.
export const Stat = ({ label, value, tone = '', sub, onClick, title }: { label: string; value: React.ReactNode; tone?: string; sub?: React.ReactNode; onClick?: () => void; title?: string }) => {
  const body = <><span>{label}</span><b>{value}{sub != null && <small>{sub}</small>}</b></>;
  return onClick ? <button className={`stat ${tone}`} onClick={onClick} title={title}>{body}</button> : <div className={`stat ${tone}`} title={title}>{body}</div>;
};

// − n + : how many of something, one step at a time
export const Stepper = ({ label, value, min, max, less, more }: { label: string; value: number; min: number; max: number; less: () => void; more: () => void }) => (
  <div className="stepper" role="group" aria-label={label}>
    <button className="icon sm ghost" disabled={value <= min} onClick={less} aria-label={`Fewer ${label.toLowerCase()}`}><Icon n="minus" s={14} /></button>
    <b aria-live="polite">{value}</b>
    <button className="icon sm ghost" disabled={value >= max} onClick={more} aria-label={`More ${label.toLowerCase()}`}><Icon n="plus" s={14} /></button>
  </div>
);

// text input that saves on blur / Enter instead of every keystroke
export function Field({ value, onSave, ...rest }: { value: string | number; onSave: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onBlur'>) {
  return (
    <input key={String(value)} defaultValue={value} {...rest}
      onBlur={e => { if (e.target.value !== String(value)) onSave(e.target.value) }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
  );
}

type Size = { w: number; h: number };
// Picks a column count so n tiles fill the element without scrolling. Falls back to fixed-height rows
// that scroll inside the element when tiles would get smaller than `min` (or on phones).
export function useFit(n: number, ideal: Size, min: Size) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ cols: 4, rows: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !n) return;
    const calc = () => {
      const gap = parseFloat(getComputedStyle(el).rowGap) || 0, W = el.clientWidth, H = el.clientHeight;
      let best: { cols: number; rows: number; score: number } | null = null, maxCols = 1;
      for (let c = 1; c <= n && innerWidth > 760; c++) {
        const r = Math.ceil(n / c), w = (W - gap * (c - 1)) / c, h = (H - gap * (r - 1)) / r;
        if (w < min.w) break;
        maxCols = c;
        const score = Math.min(w / ideal.w, h / ideal.h);
        if (h >= min.h && (!best || score > best.score)) best = { cols: c, rows: r, score };
      }
      const next = best ?? { cols: innerWidth > 760 ? maxCols : W > 480 ? 3 : 2, rows: 0 };
      setFit(f => f.cols === next.cols && f.rows === next.rows ? f : { cols: next.cols, rows: next.rows });
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [n, ideal.w, ideal.h, min.w, min.h]);
  const style: React.CSSProperties = fit.rows
    ? { gridTemplateColumns: `repeat(${fit.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${fit.rows}, minmax(0, 1fr))` }
    : { gridTemplateColumns: `repeat(${fit.cols}, minmax(0, 1fr))`, gridAutoRows: `${min.h + 24}px` };
  return [ref, style] as const;
}

const ago = (t: number) => { const m = Math.floor((now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago` };
// Beside a student who is also present in another live drive: that company, and on hover (or a tap) what they are
// doing there and since when, so both desks can coordinate. Blue while they are in a cabin there.
export function AlsoIn({ a }: { a?: Also[] }) {
  if (!a?.length) return null;
  const text = a.map(x => `Also in ${x.company}: ${x.status} (${ago(x.at)})`).join('\n');
  return (
    <span className={`also${a.some(x => x.busy) ? ' busy' : ''}`} title={text} role="img" aria-label={text}
      onClick={e => { e.stopPropagation(); toast(text) }} onPointerDown={e => e.stopPropagation()}>
      <Icon n="alert" s={12} />{a.map(x => x.company).join(', ')}
    </span>
  );
}

// Top-bar warning on a drive whose present students are present in another live drive too: how many, and a list of
// each one's status here and there, so the two desks can coordinate before calling them.
// A top-bar icon that opens a small panel under it (sync status, warnings, volunteer requests), in the ⋯ menu's style.
function Pop({ label, icon, tone = '', count, children }: { label: string; icon: keyof typeof ICONS; tone?: string; count?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useOutside(open, setOpen, ref);
  return (
    <span ref={ref} className={`kebab${open ? ' open' : ''}`}>
      <button className={`icon ghost tb ${tone}`} title={label} aria-label={label} aria-expanded={open} onClick={e => { e.stopPropagation(); setOpen(!open) }}>
        <Icon n={icon} />{!!count && <span className="tb-n">{count}</span>}
      </button>
      {open && <div className="menu down pop" role="dialog" aria-label={label}>{children}</div>}
    </span>
  );
}

// For seniors, in every top bar while anyone is waiting: members asking to volunteer, each with Decline and Approve.
// Approving puts them on that phase's volunteers, which also lets them run the drive.
type OpenAsk = Ask & { name: string; company: string; when: string };
function Requests() {
  const p = usePeople(), mine = lead(p?.me);
  const [open, setOpen] = useState<OpenAsk[]>([]);
  const load = useCallback(() => { fetch(withPin('/api/volunteers')).then(r => r.ok ? r.json() : null).then(j => j && setOpen(j.open), () => {}) }, []);
  useEffect(() => {
    if (!mine) return;
    load();
    const i = setInterval(load, 10000);
    return () => clearInterval(i);
  }, [mine, load]);
  if (!mine || !open.length) return null;
  const decide = async (a: OpenAsk, what: 'approve' | 'deny') => {
    try { const j = await post('/api/volunteers', { drive: a.drive, k: a.k, user: a.user, what }); if (j.msg) toast(j.msg) } catch { /* already shown */ }
    load();
  };
  const n = open.length;
  return (
    <Pop label={`${n} volunteer request${n > 1 ? 's' : ''}`} icon="hand" tone="req" count={n}>
      <section className="pop-s">
        <b>Volunteer requests · {n}</b>
        <p>Approving adds them to the phase&rsquo;s volunteers, and lets them run the drive.</p>
        <ul>{open.map(a => (
          <li key={a.drive + a.k + a.user} className="vreq">
            <div><Av n={a.name} /><b>{a.name}</b></div>
            <span>{a.company} · {PHASES[a.k]} · {when(a.when)}</span>
            <div className="row"><div className="sp" /><button className="sm" onClick={() => decide(a, 'deny')}>Decline</button><button className="sm primary" onClick={() => decide(a, 'approve')}><Icon n="check" s={13} />Approve</button></div>
          </li>
        ))}</ul>
      </section>
    </Pop>
  );
}

// ⚠ in a drive's top bar, only while a student here is present in another live drive too: what they are doing in each.
export function Warnings({ d, also }: { d: Drive; also: Seen }) {
  const shared = d.students.filter(s => also[s.id]?.length), n = shared.length;
  if (!n) return null;
  const here = (s: Drive['students'][number]) => s.status === 'in' ? `In ${d.rooms.find(r => r.id === s.room)?.name ?? 'a cabin'}` : statusLabel(d, s);
  return (
    <Pop label={`${n} warning${n > 1 ? 's' : ''}`} icon="alert" tone="warn" count={n}>
      <section className="pop-s">
        <b>Also in another live drive · {n}</b>
        <p>Check with that desk before calling them.</p>
        <ul>{shared.map(s => (
          <li key={s.id}>
            <div><b>{s.name}</b><span className="reg">{s.reg}</span></div>
            <span>{d.company} (this drive): {here(s)}</span>
            {also[s.id].map(a => <span key={a.company} className={a.busy ? 'busy' : ''}>{a.company}: {a.status} · {ago(a.at)}</span>)}
          </li>
        ))}</ul>
      </section>
    </Pop>
  );
}

// Lucide icon outlines (lucide.dev, ISC licence)
const ICONS = {
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18M6 6l12 12',
  minus: 'M5 12h14',
  plus: 'M5 12h14M12 5v14',
  right: 'M5 12h14M12 5l7 7-7 7',
  left: 'M19 12H5M12 19l-7-7 7-7',
  prev: 'm15 18-6-6 6-6',
  next: 'm9 18 6-6-6-6',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  flag: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',
  trash: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  moon: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41',
  more: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  settings: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  logs: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M12 7v5l4 2',
  reopen: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5',
  search: 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM21 21l-4.35-4.35',
  calendar: 'M8 2v4M16 2v4M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 10h18',
  pin: 'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0zM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2',
  eye: 'M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  eyeOff: 'M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20M14.12 14.12a3 3 0 1 1-4.24-4.24',
  cloudOk: 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9zM9.5 14l2 2 3.5-3.5',
  cloudUp: 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9zM12 17v-5M9.5 14.5 12 12l2.5 2.5',
  cloudOff: 'm2 2 20 20M5.78 5.78A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.31-.19M21.53 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7 7 0 0 0 10 5.07',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  alert: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3zM12 9v4M12 17h.01',
  roll: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM16 11l2 2 4-4',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 16v-4M12 8h.01',
  refresh: 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8M21 3v5h-5',
  present: 'M2 3h20M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3M7 21l5-5 5 5',
  monitor: 'M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 21h8M12 17v4',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  hand: 'M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15',
  userPlus: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM19 8v6M22 11h-6',
  key: 'M2.59 17.41A2 2 0 0 0 2 18.83V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.17a2 2 0 0 0 1.42-.59l.81-.81a6.5 6.5 0 1 0-4-4zM16.5 7.5h.01',
  copy: 'M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2zM4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2',
  shield: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
};
export const Icon = ({ n, s = 16 }: { n: keyof typeof ICONS; s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={ICONS[n]} /></svg>
);

// the name, with Desk in the brand's ember like the logo's free cabin
export const Wordmark = () => <span className="wm">Drive<em>Desk</em></span>;

// the app's mark: four cabins, one free (same drawing as app/icon.svg, the browser-tab icon); colours follow the theme
export const Logo = ({ s = 28 }: { s?: number }) => (
  <svg className="logo" width={s} height={s} viewBox="0 0 32 32" aria-hidden>
    <rect className="lg-t" width="32" height="32" rx="7" />
    <rect className="lg-c" x="8.5" y="8.5" width="6.5" height="6.5" rx="1.8" /><rect className="lg-f" x="17" y="8.5" width="6.5" height="6.5" rx="1.8" />
    <rect className="lg-c" x="8.5" y="17" width="6.5" height="6.5" rx="1.8" /><rect className="lg-c" x="17" y="17" width="6.5" height="6.5" rx="1.8" />
  </svg>
);

// The bar at the top of every desk page: the app (a link home), where you are, then the page's own buttons.
// title: the drive's name, which leads back to its dashboard (`to`: a page, or a way back within this one); sub: where in it
export const TopBar = ({ title, sub, to, badge, children }: { title?: string; sub?: string; to?: string | (() => void); badge?: React.ReactNode; children?: React.ReactNode }) => (
  <header className="top">
    <Link href="/" className="brand" title="All drives"><Logo /><Wordmark /></Link>
    {title && <><span className="slash" aria-hidden>/</span>{
      typeof to === 'string' ? <Link className="crumb go" href={to} title={`${title}: drive dashboard`}>{title}</Link>
      : to ? <button className="crumb go" onClick={to} title={`${title}: drive dashboard`}>{title}</button>
      : <b className="crumb" title={title}>{title}</b>}</>}
    {sub && <><span className="slash" aria-hidden>/</span><b className="crumb">{sub}</b></>}
    {badge}
    <div className="sp" />
    <Requests />
    <SyncStatus />
    {children && <div className="tools">{children}</div>}
  </header>
);

// ⋯ menu item: sign this laptop out
const signOutItem: [React.ReactNode, () => void] = [<><Icon n="logout" />Sign out</>, async () => {
  if (!await ask('Sign out of this laptop?', 'The desk stays closed here until someone signs in again. Changes that haven’t uploaded yet wait on this laptop.', 'Sign out', true)) return;
  try { await post('/api/sync', undefined, 'DELETE'); location.reload() } catch { /* already shown */ }
}];

// The account button at the right of the top bar: the signed-in member's initials (⋯ when nobody is), opening who they
// are, the page's own items, Accounts for the admin, then the theme, About & updates and Sign out. A red dot on it, and on
// About & updates, means a newer DriveDesk is out.
export function DeskMenu({ items = [] }: { items?: [React.ReactNode, () => void][] }) {
  const [dark, flip] = useTheme();
  const u = useUpdate(), p = usePeople(), router = useRouter();
  const [about, setAbout] = useState(false);
  const fresh = !!u?.next, me = p?.me;
  return <>
    <More label={`${me ? me.name : 'More'}${fresh ? ' (update available)' : ''}`} className={me ? 'icon ghost tb me' : 'icon ghost'} down dot={fresh}
      head={me && <div className="menu-me"><Av n={me.name} /><div><b>{me.name}</b><span>{me.user}</span></div><span className={`pill role-${me.role}`}>{me.role}</span></div>}
      items={[...items,
      ...p?.me?.role === 'admin' ? [[<><Icon n="shield" />Accounts</>, () => router.push('/accounts')] as [React.ReactNode, () => void]] : [],
      [<><Icon n={dark ? 'sun' : 'moon'} />{dark ? 'Light theme' : 'Dark theme'}</>, flip],
      [<><Icon n="info" />About &amp; updates{fresh && <i className="dot" title="Update available" />}</>, () => setAbout(true)],
      signOutItem]}>{me && <Av n={me.name} />}</More>
    {about && <About u={u} close={() => setAbout(false)} />}
  </>;
}

// What the desktop app says about updates (electron/main.js, through electron/preload.cjs). A browser has no updater.
type Update = {
  state: 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'installing' | 'error';
  next?: { version: string; date?: string; notes?: string }; progress?: number; checked?: number; error?: string; data?: string;
};
declare global { interface Window { desk?: { ask: (what: 'state' | 'check' | 'install' | 'data') => Promise<Update>; onUpdate: (f: (u: Update) => void) => () => void } } }
function useUpdate() {
  const [u, setU] = useState<Update | null>(null);
  useEffect(() => { const d = window.desk; if (!d) return; d.ask('state').then(setU); return d.onUpdate(setU) }, []);
  return u;
}

// ⋯ › About & updates: this version, a newer one if there is (one click installs it and DriveDesk reopens by itself),
// the account and where the drives are saved
function About({ u, close }: { u: Update | null; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [account, setAccount] = useState<string | null>(null);
  useEffect(() => {
    letGo();
    ref.current?.showModal();
    fetch(withPin('/api/sync')).then(r => r.ok ? r.json() : null).then(j => setAccount(j?.account ?? null), () => {});
    // a fresh answer to "is there a newer one?" without pressing the button
    if (u && !u.next && Date.now() - (u.checked ?? 0) > 10 * 60e3) window.desk?.ask('check');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <dialog ref={ref} className="about" onClose={close}>
      <div className="about-h">
        <Logo s={46} />
        <div><Wordmark /><p className="meta">Version {process.env.DESK_VERSION}</p></div>
      </div>
      {u && <Updates u={u} />}
      {(account || u?.data) && <dl>
        {account && <><dt>Signed in as</dt><dd>{account}</dd></>}
        {u?.data && <><dt>Drives saved in</dt><dd><span title={u.data}>{u.data}</span><button className="link" onClick={() => window.desk?.ask('data')}>Show</button></dd></>}
      </dl>}
      <form method="dialog" className="row">
        <div className="sp" /><button autoFocus>Close</button>
      </form>
    </dialog>
  );
}

function Updates({ u }: { u: Update }) {
  const n = u.next, pct = Math.round((u.progress ?? 0) * 100);
  if (u.state === 'downloading') return (
    <div className="upd on" role="status">
      <b>Downloading DriveDesk {n?.version}…<span>{pct}%</span></b>
      <progress max={100} value={pct} />
      <small>DriveDesk restarts by itself when it’s done. You can keep working until then.</small>
    </div>
  );
  if (u.state === 'installing') return (
    <div className="upd on" role="status"><b className="spin">Installing DriveDesk {n?.version}…</b><small>It closes and opens again in a few seconds.</small></div>
  );
  if (n) return (
    <div className="upd on">
      <b><i className="dot" />DriveDesk {n.version} is available</b>
      {n.notes && n.notes !== n.version && <p className="notes">{n.notes}</p>}
      {u.state === 'error' && <p className="upd-err" role="alert">{u.error}</p>}
      <button className="primary" onClick={() => window.desk?.ask('install')}><Icon n="download" />{u.state === 'error' ? 'Try again' : 'Update and restart'}</button>
      <small>DriveDesk downloads it, then closes and opens again by itself. Every drive is saved, so nothing is lost.</small>
    </div>
  );
  return (
    <div className="upd">
      {u.state === 'error' ? <><b>Couldn’t check for updates</b><p className="upd-err" role="alert">{u.error}</p></>
        : u.state === 'latest' ? <><b><Icon n="check" />You’re up to date</b><small>Checked {ago(u.checked!)}</small></>
        : <b className="spin">Checking for updates…</b>}
      <button disabled={u.state === 'checking'} onClick={() => window.desk?.ask('check')}><Icon n="refresh" />Check for updates</button>
    </div>
  );
}
