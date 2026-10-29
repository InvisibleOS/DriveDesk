'use client';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LABEL, called, feeds, lead, eligible, missed, unlisted, endOf, forecast, phasesOf, shortOf, startOf, titleOf, type Drive, type Phase, type PhaseId, type Pupil, type Status } from '@/lib/drive';
import { Board, Camp, span } from '../../board';
import { Activity, Setup, Students, Summary } from '../../panels';
import { DriveDash } from '../../phases';
import { AlsoIn, DeskMenu, Field, Warnings, Icon, PageHead, Sheet, Stat, TopBar, ask, longDate, post, tm, useDrive, useNow, useSheet, type Seen, type Send } from '../../ui';

type Tab = 'board' | 'setup' | 'log'; // 'board' is the summary once a drive has ended
const STATS = [['present', 'Present', ''], ['in', 'In cabins', 'in'], ['pending', 'Awaiting', 'pend'], ['selected', 'Selected', 'ok'], ['rejected', 'Rejected', 'no'], ['absent', 'Absent', 'abs'], ['out', 'Not eligible', '']] as const;

// while a drive runs: how long students wait for each call (from attendance, then from leaving the cabin before), and when the last interview likely ends
const Finish = ({ d }: { d: Drive }) => {
  const f = forecast(d, useNow()), start = Math.min(d.attendance ?? d.startedAt, d.startedAt);
  const w = d.students.flatMap(s => s.hist.map((h, i) => h.call - (i ? s.hist[i - 1].out ?? h.call : start))).filter(x => x > 0);
  return <>{w.length > 0 && <> · avg wait {span(w.reduce((a, b) => a + b) / w.length)}</>}{f && f.done > Date.now() && <> · likely done by {tm(f.done)}</>}</>;
};
// the drive's date, place and hours, under the top bar
const Meta = ({ d }: { d: Drive }) => (
  <div className="pmeta">
    <span><Icon n="calendar" s={14} />{longDate(d.date)}</span>
    {d.location && <span><Icon n="pin" s={14} />{d.location}</span>}
    {(called(d) || !!d.endedAt) && <span><Icon n="clock" s={14} />{d.endedAt ? `${tm(d.startedAt)} – ${tm(d.endedAt)} · ${span(d.endedAt - d.startedAt)}` : <>Started {tm(d.startedAt)}{d.status === 'live' && <Finish d={d} />}</>}</span>}
  </div>
);

export default function Desk() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { x, live, send, gate } = useDrive(id);
  const [tab, setTab] = useState<Tab>('board');
  const [inside, setInside] = useState(false); // the interview dashboard, opened from the drive's interviews column
  const [att, setAtt] = useState<PhaseId | null>(null); // a talk's or test's attendance, opened from the drive dashboard
  const [view, setView] = useState<Status | 'present' | 'out' | null>(null); // header number clicked → read-only list of those students
  const [sheet, showSheet] = useSheet();
  useEffect(() => { if (view) showSheet() }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
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

  const d = x.drive, done = d.status === 'done', n = (st: string) => st === 'out' ? unlisted(d).length : d.students.filter(s => st === 'present' ? s.status !== 'absent' : s.status === st).length + (st === 'absent' ? missed(d).length : 0); // absent counts those who missed a PPT or OA too
  const title = (k: Status | 'present' | 'out') => k === 'present' ? 'Present' : k === 'out' ? 'Not eligible' : LABEL[k];
  const cur: Tab = done && tab === 'setup' ? 'board' : tab; // an ended drive has its summary and logs, no settings
  const del = async () => {
    if (!await ask(`Delete the ${d.company} drive?`, `${longDate(d.date)}. It disappears from the dashboard and calendar. The file is kept in data/trash.`, 'Delete drive', true)) return;
    try { await post(`/api/drives/${id}`, undefined, 'DELETE'); router.push('/') } catch { /* already shown */ }
  };
  // a drive opens on its phases; the interview dashboard is one of them, left through the drive's name in the top bar.
  // Each phase's attendance, and the interview board, only for those who run that phase (x.can: a senior, or its volunteers).
  const out = () => setInside(false);
  if (d.status === 'planned' || !inside || !x.can.int) {
    const ap = phasesOf(d).find(p => p.id === att);
    if (ap && x.can[ap.id] && Date.now() < endOf(ap)) return <PhaseRoll d={d} p={ap} send={send} back={() => setAtt(null)} />;
    const attend = (p: Phase) => { if (!p.roll) send({ type: 'phaseRoll', k: p.id }); setAtt(p.id) };
    return <DriveDash d={d} send={send} onDelete={del} open={() => setInside(true)} attend={attend} me={x.me} can={x.can} asks={x.asks} />;
  }
  if (d.status === 'live' && !d.attendance) return <Attendance d={d} send={send} also={x.also} out={out} />;

  return (
    <div className="app">
      <TopBar title={d.company} sub="Interviews" to={out} badge={done ? <span className="pill hide-sm">Completed</span>
        : x.held ? <span className="pill warn" title="Another laptop changed this drive in the last 10 minutes. You can watch it here; take over to run it from this laptop">Running on {x.held}</span>
        : <span className={`pill ${live ? 'ok live' : 'warn'}`} title={live ? 'Connected. Changes save instantly' : 'Lost connection to the server, retrying'}>{live ? 'Live' : 'Reconnecting…'}</span>}>
        {!done && <Warnings d={d} also={x.also} />}
        {x.held ? <>
          <button className="primary" onClick={async () => { if (await ask('Run this drive from this laptop?', `${x.held} stops being able to change it until it takes over again. Do this when that laptop is closed or has moved on.`, 'Take over')) send({ type: 'takeOver' }) }}>Take over</button>
          <DeskMenu items={[[<><Icon n="logs" />Logs</>, () => setTab('log')]]} />
        </> : done ? <>
          <button onClick={() => send({ type: 'reopen' })} title="Reopen this drive" aria-label="Reopen drive"><Icon n="reopen" /><span className="hide-sm">Reopen drive</span></button>
          {lead(x.me) && <button className="icon ghost" onClick={del} title="Delete this drive" aria-label="Delete this drive"><Icon n="trash" /></button>}
          <DeskMenu items={[[<><Icon n="logs" />Logs</>, () => setTab('log')]]} />
        </> : <>
          <button className="icon ghost" disabled={!x.undo} onClick={() => send({ type: 'undo' })} title={x.undo ? `Undo: ${x.undo} (Ctrl/⌘+Z)` : 'Nothing to undo'} aria-label="Undo"><Icon n="undo" /></button>
          <DeskMenu items={[[<><Icon n="settings" />Settings</>, () => setTab('setup')], [<><Icon n="logs" />Logs</>, () => setTab('log')]]} />
        </>}
      </TopBar>
      <main>
        {cur === 'board' ? <>
          <PageHead title={d.company} meta={<Meta d={d} />}>
            <div className="stats">
              {/* an ended drive has nobody in a cabin; Awaiting stays only while some results were never given; Not eligible, while anyone is */}
              {STATS.filter(([k]) => (k !== 'out' || n(k) > 0) && (!done || (k !== 'in' && (k !== 'pending' || n(k) > 0)))).map(([k, l, c]) => (
                <Stat key={k} label={l} value={n(k)} tone={c} onClick={() => setView(k)} title={`Show ${title(k).toLowerCase()}`} />
              ))}
            </div>
          </PageHead>
          {done ? <Summary d={d} /> : d.students.length ? <Board d={d} send={send} also={x.also} setup={() => setTab('setup')} /> : (
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
      <Sheet sheet={sheet} title={view && title(view)} count={view ? n(view) : undefined} onClose={() => setView(null)}>
        {view && <Students key={view} d={d} status={view} send={send} also={x.also} />}
      </Sheet>
    </div>
  );
}

// Before any interview: everyone starts ticked present; untick whoever is missing (the reason is optional).
const Attendance = ({ d, send, also, out }: { d: Drive; send: Send; also: Seen; out: () => void }) => (
  <RollCall d={d} home={out} people={d.students} roll={d.roll} also={also} meta={<Meta d={d} />} earlier={missed(d)} send={send}
    mark={(id, absent, reason) => send({ type: 'roll', id, absent, reason })} start={() => send({ type: 'roll' })}
    top={<Warnings d={d} also={also} />}
    intro={`${d.students.length} student${d.students.length === 1 ? '' : 's'} on the list. Saved as it is taken; confirming it makes it final.`}
    bar={<><button onClick={out}><Icon n="left" />Back to drive</button><button className="primary" onClick={() => send({ type: 'attendance' }).then(out)}><Icon n="check" />Confirm attendance</button></>} />
);

// A talk's or test's attendance, of the students eligible for it. Saved as it is taken; final once the phase ends,
// which is done from its column on the drive's page.
const PhaseRoll = ({ d, p, send, back }: { d: Drive; p: Phase; send: Send; back: () => void }) => (
  <RollCall d={d} home={back} people={eligible(d, p.id)} roll={p.roll} badge={`${shortOf(d, p)} attendance`} send={send}
    earlier={missed(d).filter(m => feeds(d, phasesOf(d).findIndex(x => x.id === p.id)).some(g => g.id === m.k))}
    meta={<div className="pmeta"><span><Icon n="roll" s={14} />{titleOf(d, p)}</span><span><Icon n="clock" s={14} />{p.k === 'ppt' ? `Started ${tm(startOf(p))} · ends by ${tm(endOf(p))}` : Date.now() < startOf(p) ? `Goes live at ${tm(startOf(p))} · can be ended from then` : `Started ${tm(startOf(p))} · runs until you end it`}</span>{p.venue && <span><Icon n="pin" s={14} />{p.venue}</span>}</div>}
    mark={(id, absent, reason) => send({ type: 'phaseRoll', k: p.id, id, absent, reason })} start={() => send({ type: 'phaseRoll', k: p.id })}
    intro={`${eligible(d, p.id).length} eligible students.`}
    bar={<button onClick={back}><Icon n="left" />Back to drive</button>} />
);

// The list is saved as it is taken, so a refresh or a volunteer's phone carries on from the same place.
// Unticked students move to a section at the bottom: reading the list top to bottom, nothing above you ever shifts.
// Roll call by keyboard: a highlighted row follows the names as they are read out; Enter = present, A = absent, both move on.
function RollCall({ d, home, people, roll, mark, start, intro, bar, meta, top, also = {}, badge = 'Attendance', earlier, send }: {
  d: Drive; home: () => void; people: Pupil[]; roll?: Record<string, string>; mark: (id: string, absent: boolean, reason?: string) => void; start: () => void;
  intro: string; bar: React.ReactNode; meta: React.ReactNode; top?: React.ReactNode; also?: Seen; badge?: string;
  earlier: ReturnType<typeof missed>; send: Send; // absent at a phase before this one, so not on this list unless made eligible
}) {
  const [q, setQ] = useState('');
  const [cur, setCur] = useState<string | null>(null); // highlighted student
  const off = roll ? Object.keys(roll).length : 0; // roll: undefined until Take attendance is pressed
  const shown = people.map((s, i) => ({ s, i })).filter(({ s }) => `${s.reg} ${s.name}`.toLowerCase().includes(q.toLowerCase()));
  const here = shown.filter(({ s }) => !roll || !(s.id in roll)), gone = shown.filter(({ s }) => roll && s.id in roll);
  const before = earlier.filter(({ s }) => `${s.reg} ${s.name}`.toLowerCase().includes(q.toLowerCase()));
  const ci = people.findIndex(s => s.id === cur), j = here.findIndex(({ i }) => i >= ci);
  const at = j < 0 ? here.length - 1 : j, hi = here[at]?.s.id; // the highlighted name (the first by default); once it's marked absent, the next one
  useEffect(() => {
    if (!roll) return;
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches?.('input,textarea,select,button,a') || e.metaKey || e.ctrlKey || e.altKey || !hi) return;
      const go = (i: number) => { e.preventDefault(); setCur(here[Math.min(Math.max(i, 0), here.length - 1)]?.s.id ?? null) };
      if (e.key === 'Enter' || e.key === 'ArrowDown') go(at + 1);
      else if (e.key === 'ArrowUp') go(at - 1);
      else if (e.key === 'a' || e.key === 'A') { mark(hi, true); go(at + 1) } // marked absent, it moves to the bottom
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [roll, here, at, hi, mark]);
  useEffect(() => { document.querySelector('.att tr.cur')?.scrollIntoView({ block: 'nearest' }) }, [hi]);
  const row = ({ s, i }: { s: Pupil; i: number }) => {
    // only the checkbox marks someone absent or present; a click elsewhere on the row just moves the highlight
    const out = !!roll && s.id in roll, flip = () => mark(s.id, !out);
    const reason = out && <Field value={roll![s.id]} placeholder="Reason (optional)" maxLength={200} aria-label={`Why ${s.name} is absent`}
      onSave={reason => mark(s.id, true, reason)} />; // beside the name on a laptop, under it on a phone
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
      <TopBar title={d.company} to={home} badge={<span className="pill warn hide-sm">{badge}</span>}>{top}<DeskMenu /></TopBar>
      <main>
        {!roll ? (
          <div className="emptyst planned centered">
            <span className="okmark accent"><Icon n="roll" s={20} /></span>
            <div>
              <h2>Take attendance</h2>
              <p className="meta">{intro}</p>
            </div>
            <div className="row foot">
              <button onClick={home}><Icon n="left" />Back to drive</button>
              <button className="primary" onClick={start}>Take attendance<Icon n="right" /></button>
            </div>
          </div>
        ) : (<>
          <PageHead title={d.company} meta={meta}>
            <div className="stats"><Stat label="Present" value={people.length - off} /><Stat label="Absent" value={off} tone="abs" /></div>
          </PageHead>
          <div className="panel att">
            <div className="panel-bar">
              <label className="search w240"><Icon n="search" s={14} /><input type="search" placeholder="Search by name or reg. no." value={q} onChange={e => setQ(e.target.value)} aria-label="Search students" /></label>
              <span className="keys hide-sm"><kbd>Enter</kbd> present <kbd>A</kbd> absent <kbd>↑</kbd><kbd>↓</kbd> move</span>
              <div className="sp" />
              {bar}
            </div>
            <div className="scroll">
              <table>
                <thead><tr><th className="cb">Present</th><th className="hide-sm">#</th><th className="hide-sm">Reg. no.</th><th>Name</th><th className="hide-sm">Campus</th><th className="hide-sm">Reason for absence</th></tr></thead>
                <tbody>
                  {here.map(row)}
                  {gone.length > 0 && <tr className="sect"><td colSpan={6}>Marked absent · {gone.length}</td></tr>}
                  {gone.map(row)}
                  {before.length > 0 && <tr className="sect"><td colSpan={6}>Absent at an earlier phase · {before.length}<span> · make them eligible to add them here</span></td></tr>}
                  {before.map(({ s, k, p, reason }) => (
                    <tr key={s.id} className="abs">
                      <td className="cb" />
                      <td className="num hide-sm" />
                      <td className="reg hide-sm">{s.reg}</td>
                      <td><b>{s.name}</b><small className="reg sm-only">{s.reg}</small></td>
                      <td className="hide-sm"><Camp c={s.campus} /></td>
                      <td><div className="why"><span className="meta nowrap">Missed the {shortOf(d, p)}</span>
                        <Field value={reason} placeholder="Reason (optional)" maxLength={200} aria-label={`Why ${s.name} missed the ${shortOf(d, p)}`} onSave={reason => send({ type: 'reason', k, id: s.id, reason })} />
                        <button className="sm" onClick={() => send({ type: 'excuse', k, id: s.id })}><Icon n="check" s={13} />Make eligible</button></div></td>
                    </tr>
                  ))}
                  {!shown.length && !before.length && <tr><td colSpan={6} className="empty">No students</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>)}
      </main>
    </div>
  );
}
