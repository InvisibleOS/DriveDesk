'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { LABEL, localDate, type Drive, type Status } from '@/lib/drive';
import { Board, Camp } from '../../board';
import { Activity, LocationPick, Setup, Students, Summary, exportCSV } from '../../panels';
import { AlsoIn, DeskMenu, Field, Warnings, Icon, TopBar, ask, letGo, longDate, post, tm, useDrive, type Live, type Seen, type Send } from '../../ui';

type Tab = 'board' | 'setup' | 'log'; // 'board' is the summary once a drive has ended
const STATS = [['present', 'Present', ''], ['in', 'In cabins', 'in'], ['pending', 'Awaiting', 'pend'], ['selected', 'Selected', 'ok'], ['rejected', 'Rejected', 'no'], ['absent', 'Absent', 'abs']] as const;

const span = (ms: number) => { const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min` };
// the drive's date, place and hours, under the top bar
const Meta = ({ d }: { d: Drive }) => (
  <div className="pmeta">
    <span><Icon n="calendar" s={14} />{longDate(d.date)}</span>
    {d.location && <span><Icon n="pin" s={14} />{d.location}</span>}
    {d.startedAt > 0 && <span><Icon n="clock" s={14} />{d.endedAt ? `${tm(d.startedAt)} – ${tm(d.endedAt)} · ${span(d.endedAt - d.startedAt)}` : `Started ${tm(d.startedAt)}`}</span>}
  </div>
);

export default function Desk() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { x, live, send, gate } = useDrive(id);
  const [tab, setTab] = useState<Tab>('board');
  const [view, setView] = useState<Status | 'present' | null>(null); // header number clicked → read-only list of those students
  const sheet = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (view) { letGo(); sheet.current?.showModal() } }, [view]);
  const company = x?.drive.company;
  useEffect(() => { if (company) document.title = `${company} · DriveDesk` }, [company]); // tells tabs apart when several drives are open
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !(e.target as HTMLElement).matches('input,textarea,select')) { e.preventDefault(); send({ type: 'undo' }) }
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [send]);
  if (gate || !x) return gate;

  const d = x.drive, done = d.status === 'done', n = (st: string) => d.students.filter(s => st === 'present' ? s.status !== 'absent' : s.status === st).length;
  const title = (k: Status | 'present') => k === 'present' ? 'Present' : LABEL[k];
  const cur: Tab = done && tab === 'setup' ? 'board' : tab; // an ended drive has its summary and logs, no settings
  const end = async () => { if (await ask(`End the ${d.company} drive?`, 'It moves to the calendar as completed. You can reopen it later if needed.', 'End drive')) send({ type: 'finish' }) };
  const del = async () => {
    if (!await ask(`Delete the ${d.company} drive?`, `${longDate(d.date)}. It disappears from the dashboard and calendar. The file is kept in data/trash.`, 'Delete drive', true)) return;
    try { await post(`/api/drives/${id}`, undefined, 'DELETE'); router.push('/') } catch { /* already shown */ }
  };
  if (d.status === 'planned') return <Planned d={d} send={send} onDelete={del} />;
  if (d.status === 'live' && !d.attendance) return <Attendance d={d} send={send} also={x.also} placed={x.placed} />;

  return (
    <div className="app">
      <TopBar title={d.company} badge={done ? <span className="pill hide-sm">Completed</span>
        : x.held ? <span className="pill warn" title="Another laptop changed this drive in the last 10 minutes. You can watch it here; take over to run it from this laptop">Running on {x.held}</span>
        : <span className={`pill ${live ? 'ok live' : 'warn'}`} title={live ? 'Connected. Changes save instantly' : 'Lost connection to the server, retrying'}>{live ? 'Live' : 'Reconnecting…'}</span>}>
        {!done && <Warnings d={d} also={x.also} placed={x.placed} />}
        {x.held ? <>
          <button className="primary" onClick={async () => { if (await ask('Run this drive from this laptop?', `${x.held} stops being able to change it until it takes over again. Do this when that laptop is closed or has moved on.`, 'Take over')) send({ type: 'takeOver' }) }}>Take over</button>
          <DeskMenu items={[[<><Icon n="logs" />Logs</>, () => setTab('log')]]} />
        </> : done ? <>
          <button onClick={() => exportCSV(d)} title="Download the results sheet (Excel)" aria-label="Results"><Icon n="download" /><span className="hide-sm">Results</span></button>
          <button onClick={() => send({ type: 'reopen' })} title="Reopen this drive" aria-label="Reopen drive"><Icon n="reopen" /><span className="hide-sm">Reopen drive</span></button>
          <button className="icon ghost" onClick={del} title="Delete this drive" aria-label="Delete this drive"><Icon n="trash" /></button>
          <DeskMenu items={[[<><Icon n="logs" />Logs</>, () => setTab('log')]]} />
        </> : <>
          <button className="icon ghost" disabled={!x.undo} onClick={() => send({ type: 'undo' })} title={x.undo ? `Undo: ${x.undo} (Ctrl/⌘+Z)` : 'Nothing to undo'} aria-label="Undo"><Icon n="undo" /></button>
          <button className="danger" onClick={end} title="Finish this drive and move it to the calendar history"><Icon n="flag" /><span className="hide-sm">End drive</span></button>
          <DeskMenu items={[[<><Icon n="settings" />Settings</>, () => setTab('setup')], [<><Icon n="logs" />Logs</>, () => setTab('log')]]} />
        </>}
      </TopBar>
      <main>
        {cur === 'board' ? <>
          <div className="phead">
            <div><h1>{d.company}</h1><Meta d={d} /></div>
            <div className="stats">
              {/* an ended drive has nobody in a cabin; Awaiting stays only while some results were never given */}
              {STATS.filter(([k]) => !done || (k !== 'in' && (k !== 'pending' || n(k) > 0))).map(([k, l, c]) => (
                <button key={k} className={`stat ${c}`} onClick={() => setView(k)} title={`Show ${title(k).toLowerCase()}`}><span>{l}</span><b>{n(k)}</b></button>
              ))}
            </div>
          </div>
          {done ? <Summary d={d} /> : d.students.length ? <Board d={d} send={send} also={x.also} /> : (
            <div className="emptyst">
              <h2>No students yet</h2>
              <p className="meta">No students were added when this drive was set up.</p>
            </div>
          )}
        </> : (
          <div className="subview">
            <div className="subbar"><button className="sm" onClick={() => setTab('board')}><Icon n="left" s={14} />{done ? 'Summary' : 'Board'}</button>{cur === 'setup' && <h2>Settings</h2>}</div>
            {cur === 'setup' ? <Setup d={d} send={send} /> : <Activity d={d} />}
          </div>
        )}
      </main>
      <dialog ref={sheet} className="sheet" onClose={() => setView(null)} onClick={e => e.target === e.currentTarget && sheet.current?.close()}>
        {view && <>
          <div className="sheet-h"><h2>{title(view)}</h2><span className="cnt">{n(view)}</span><div className="sp" />
            <button className="icon ghost" onClick={() => sheet.current?.close()} aria-label="Close"><Icon n="x" /></button></div>
          <Students key={view} d={d} status={view} send={send} also={x.also} />
        </>}
      </dialog>
    </div>
  );
}

// A drive created for a later day: only its details until drive day, then the rest of the setup.
function Planned({ d, send, onDelete }: { d: Drive; send: Send; onDelete: () => void }) {
  const due = d.date <= localDate(Date.now());
  return (
    <div className="app">
      <TopBar title={d.company} badge={<span className={`pill ${due ? 'warn' : ''}`}>{due ? 'Not set up' : 'Scheduled'}</span>}><DeskMenu /></TopBar>
      <main>
        <div className="emptyst planned">
          <span className="okmark"><Icon n="check" s={20} /></span>
          <div>
            <h2>Drive created</h2>
            <p className="meta">{due
              ? 'It is drive day. Set up rounds, cabins and students to open the board.'
              : `Scheduled for ${longDate(d.date)}. You can set up rounds, cabins and students on the day.`}</p>
          </div>
          <label className="field">Company<Field value={d.company} onSave={name => send({ type: 'company', name })} /></label>
          <label className="field">Date<input type="date" value={d.date} onChange={e => e.target.value && send({ type: 'date', date: e.target.value })} /></label>
          <div className="field">Location<LocationPick value={d.location} onPick={location => send({ type: 'location', location })} /></div>
          <div className="row foot">
            <button className="icon ghost" onClick={onDelete} title="Delete this drive" aria-label="Delete this drive"><Icon n="trash" /></button>
            <div className="sp" />
            <Link className="btn" href="/">All drives</Link>
            {due && <Link className="btn primary" href={`/new?id=${d.id}`}>Continue setting up<Icon n="right" /></Link>}
          </div>
        </div>
      </main>
    </div>
  );
}

// Before any interview: everyone starts ticked present; untick whoever is missing (the reason is optional).
// The list is saved on the drive as it is taken (d.roll), so a refresh or a volunteer's phone carries on from the same place.
// Unticked students move to a section at the bottom: reading the list top to bottom, nothing above you ever shifts.
// Roll call by keyboard: a highlighted row follows the names as they are read out; Enter = present, A = absent, both move on.
function Attendance({ d, send, also, placed }: { d: Drive; send: Send; also: Seen; placed: Live['placed'] }) {
  const [q, setQ] = useState('');
  const [cur, setCur] = useState<string | null>(null); // highlighted student
  const roll = d.roll; // undefined until Take attendance is pressed
  const off = roll ? Object.keys(roll).length : 0;
  const shown = d.students.map((s, i) => ({ s, i })).filter(({ s }) => `${s.reg} ${s.name}`.toLowerCase().includes(q.toLowerCase()));
  const here = shown.filter(({ s }) => !roll || !(s.id in roll)), gone = shown.filter(({ s }) => roll && s.id in roll);
  const ci = d.students.findIndex(s => s.id === cur), j = here.findIndex(({ i }) => i >= ci);
  const at = j < 0 ? here.length - 1 : j, hi = here[at]?.s.id; // the highlighted name (the first by default); once it's marked absent, the next one
  useEffect(() => {
    if (!roll) return;
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches?.('input,textarea,select,button,a') || e.metaKey || e.ctrlKey || e.altKey || !hi) return;
      const go = (i: number) => { e.preventDefault(); setCur(here[Math.min(Math.max(i, 0), here.length - 1)]?.s.id ?? null) };
      if (e.key === 'Enter' || e.key === 'ArrowDown') go(at + 1);
      else if (e.key === 'ArrowUp') go(at - 1);
      else if (e.key === 'a' || e.key === 'A') { send({ type: 'roll', id: hi, absent: true }); go(at + 1) } // marked absent, it moves to the bottom
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [roll, here, at, hi, send]);
  useEffect(() => { document.querySelector('.att tr.cur')?.scrollIntoView({ block: 'nearest' }) }, [hi]);
  const row = ({ s, i }: { s: Drive['students'][number]; i: number }) => {
    // only the checkbox marks someone absent or present; a click elsewhere on the row just moves the highlight
    const out = !!roll && s.id in roll, flip = () => send({ type: 'roll', id: s.id, absent: !out });
    const reason = out && <Field value={roll![s.id]} placeholder="Reason (optional)" maxLength={200} aria-label={`Why ${s.name} is absent`}
      onSave={reason => send({ type: 'roll', id: s.id, absent: true, reason })} />; // beside the name on a laptop, under it on a phone
    return (
      <tr key={s.id} className={out ? 'abs' : s.id === hi ? 'cur' : ''} onClick={() => { if (!out) setCur(s.id) }}>
        <td className="cb"><input type="checkbox" checked={!out} onChange={flip} aria-label={`${s.name} is present`} /></td>
        <td className="num hide-sm">{i + 1}</td>
        <td className="reg hide-sm">{s.reg}</td>
        <td><b>{s.name}</b> <AlsoIn a={also[s.id]} /><small className="reg sm-only">{s.reg}</small>{out && <div className="sm-only">{reason}</div>}</td>
        <td className="hide-sm"><Camp c={s.campus} /></td>
        <td className="hide-sm">{out && reason}</td>
      </tr>
    );
  };
  return (
    <div className="app">
      <TopBar title={d.company} badge={<span className="pill warn hide-sm">Attendance</span>}><Warnings d={d} also={also} placed={placed} /><DeskMenu /></TopBar>
      <main>
        {!roll ? (
          <div className="emptyst planned centered">
            <span className="okmark accent"><Icon n="roll" s={20} /></span>
            <div>
              <h2>Take attendance</h2>
              <p className="meta">{d.students.length} student{d.students.length === 1 ? '' : 's'} on the list. Interviews start once attendance has been taken.</p>
            </div>
            <div className="row foot">
              <Link className="btn" href="/"><Icon n="left" />Back</Link>
              <button className="primary" onClick={() => send({ type: 'roll' })}>Take attendance<Icon n="right" /></button>
            </div>
          </div>
        ) : (<>
          <div className="phead">
            <div><h1>{d.company}</h1><Meta d={d} /></div>
            <div className="stats">
              <div className="stat"><span>Present</span><b>{d.students.length - off}</b></div>
              <div className="stat abs"><span>Absent</span><b>{off}</b></div>
            </div>
          </div>
          <div className="panel att">
            <div className="panel-bar">
              <label className="search w240"><Icon n="search" s={14} /><input type="search" placeholder="Search by name or reg. no." value={q} onChange={e => setQ(e.target.value)} aria-label="Search students" /></label>
              <span className="keys hide-sm"><kbd>Enter</kbd> present <kbd>A</kbd> absent <kbd>↑</kbd><kbd>↓</kbd> move</span>
              <div className="sp" />
              <button className="primary" onClick={() => send({ type: 'attendance' })}><Icon n="check" />Confirm attendance</button>
            </div>
            <div className="scroll">
              <table>
                <thead><tr><th className="cb">Present</th><th className="hide-sm">#</th><th className="hide-sm">Reg. no.</th><th>Name</th><th className="hide-sm">Campus</th><th className="hide-sm">Reason for absence</th></tr></thead>
                <tbody>
                  {here.map(row)}
                  {gone.length > 0 && <tr className="sect"><td colSpan={6}>Marked absent · {gone.length}</td></tr>}
                  {gone.map(row)}
                  {!shown.length && <tr><td colSpan={6} className="empty">No students</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>)}
      </main>
    </div>
  );
}
