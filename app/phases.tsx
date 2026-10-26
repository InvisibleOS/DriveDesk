'use client';
import { useState } from 'react';
import { KINDS, ORDER, PHASES, SHORT, VOLUNTEERS, absentAt, called, occ, canAdd, endOf, startOf, eligible, isVirtual, venuesOf, localDate, phasesOf, removable, type Drive, type Kind, type Phase, type PhaseKey, type PhaseState, type Pupil, phaseStates } from '@/lib/drive';
import { Camp } from './board';
import { CabinsEdit, RoundsEdit, Summary, Venue, exportAttendance } from './panels';
import { DeskMenu, Field, Icon, More, PageHead, Sheet, Stepper, TopBar, ask, tm, useNow, useSheet, type Send } from './ui';

// '2026-10-26T10:00' → 'Mon, 26 Oct · 10:00'
export const when = (at: string) => {
  if (!at) return 'No date yet';
  const z = new Date(at.length > 10 ? at : `${at}T00:00`), day = z.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  return at.length > 10 ? `${day} · ${tm(z.getTime())}` : day;
};
// the timeline's time: a PPT or OA from its set time, the interviews from the first call; once over, start – end
const ran = (d: Drive, p: Phase, s: PhaseState) => {
  if (s === 'Upcoming' || s === 'Today') return when(p.at);
  const int = p.k === 'int', end = int ? d.endedAt : endOf(p), start = int && called(d) ? d.startedAt : startOf(p);
  const at = `${new Date(start).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} · ${tm(start)}`;
  return s === 'Done' && end && isFinite(end) ? `${at} – ${tm(end)}` : at;
};

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (t: number) => { const z = new Date(t); return `${localDate(t)}T${pad(z.getHours())}:${pad(z.getMinutes())}` };
// the earliest and latest a phase's time can be: after the phase before it, before the one after it
const around = (ph: Phase[], i: number) => ({ min: ph[i - 1]?.at || undefined, max: ph[i + 1]?.at || undefined });
// a time for a phase added later that keeps the order: a day before the next phase, or a day after the one before,
// or halfway between them when they are closer than that
function slot(ph: Phase[], k: PhaseKey) {
  const t = (p?: Phase) => p && Date.parse(p.at.length > 10 ? p.at : `${p.at}T09:00`);
  const prev = t(ph.filter(p => ORDER.indexOf(p.k) < ORDER.indexOf(k)).at(-1)), next = t(ph.find(p => ORDER.indexOf(p.k) > ORDER.indexOf(k)));
  let at = next ? next - 864e5 : prev! + 864e5;
  if (prev && next && at <= prev) at = (prev + next) / 2;
  return stamp(at);
}

// One column per phase in the drive: where and when it happens, and who volunteers at it.
// The time pickers keep the phases in order: none before the one ahead of it.
export function PhaseColumns({ phases, onChange }: { phases: Phase[]; onChange: (k: PhaseKey, p: Partial<Phase>) => void }) {
  return (
    <div className="pcols" style={{ '--n': phases.length } as React.CSSProperties}>
      {phases.map((p, i) => (
        <section key={p.k} className="pcol">
          <h3><span className="pico"><Icon n={PICON[p.k]} s={15} /></span>{PHASES[p.k]}</h3>
          <label className="field">Venue<Venue value={p.venue} options={venuesOf(p.k)} onSave={venue => onChange(p.k, { venue })} /></label>
          <label className="field">Date and time<input type="datetime-local" {...around(phases, i)} value={p.at} onChange={e => onChange(p.k, { at: e.target.value })} /></label>
          <div className="field">Volunteers<Crew names={p.crew} onChange={crew => onChange(p.k, { crew })} /></div>
        </section>
      ))}
    </div>
  );
}

// A phase's volunteers: a chip per person (× takes them off), and + Add with a menu of those not on it yet.
const initials = (n: string) => n.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
export const Av = ({ n }: { n: string }) => <i className="av" aria-hidden>{initials(n)}</i>;
export function Crew({ names, onChange }: { names: string[]; onChange: (n: string[]) => void }) {
  const free = VOLUNTEERS.filter(n => !names.includes(n));
  return (
    <div className="crew">
      {names.map(name => (
        <span key={name} className="vchip"><Av n={name} />{name}
          <button className="icon ghost" onClick={() => onChange(names.filter(x => x !== name))} title={`Remove ${name}`} aria-label={`Remove ${name}`}><Icon n="x" s={12} /></button>
        </span>
      ))}
      {free.length > 0 && <More label="Add a volunteer" className="sm ghost vadd" down items={free.map(n => [<><Av n={n} />{n}</>, () => onChange([...names, n])])}>
        <Icon n="plus" s={13} />{names.length ? 'Add' : 'Add volunteer'}</More>}
    </div>
  );
}

// colourless until done, then green; a live phase's dot pulses
const TONE: Record<PhaseState, string> = { Done: 'ok', Live: 'ok live', Today: 'warn', Upcoming: '' };
export const PICON = { ppt: 'present', oa: 'monitor', int: 'users' } as const;
// a row of small numbers inside a card: [label, value, tone]
export const Mini = ({ items }: { items: [string, React.ReactNode, string?][] }) => (
  <div className="mini">{items.map(([l, v, c]) => <div key={l} className={c}><b>{v}</b><span>{l}</span></div>)}</div>
);

// how a phase stands in words: 'In 3 days', 'Today at 14:00', 'Live since 14:00', 'Held on Sat, 24 Oct'
function lead(d: Drive, p: Phase, s: PhaseState) {
  const days = Math.round((Date.parse(p.at.slice(0, 10)) - Date.parse(localDate(Date.now()))) / 864e5);
  if (s === 'Done') return `Held on ${when(p.k === 'int' && called(d) ? localDate(d.startedAt) : p.at.slice(0, 10))}`; // interviews: the day they really ran
  if (s === 'Live') return p.k === 'ppt' ? `Live since ${tm(Date.parse(p.at))}` : p.k !== 'int' ? 'Live now' : called(d) ? `Running since ${tm(d.startedAt)}` : d.attendance ? 'Attendance taken, no one called yet' : 'Attendance open';
  if (days < 0) return `Set for ${when(p.at.slice(0, 10))}`; // an OA or interviews not begun after their date: the time was only a reference
  if (!days) return p.at.length > 10 ? `Today at ${tm(new Date(p.at).getTime())}` : 'Today';
  return days === 1 ? 'Tomorrow' : `In ${days} days`;
}

// The whole drive: a timeline of its phases, and under each one a column with where, when, who and how it went.
// Phases it doesn't have yet are added from the top bar. The company and type of offer, set when it was created, stay as they are.
export function DriveDash({ d, send, onDelete, open, attend }: { d: Drive; send: Send; onDelete: () => void; open: () => void; attend: (p: Phase) => void }) {
  const ph = phasesOf(d), st = phaseStates(d, useNow()); // states move on with the clock
  const plan = (p: Partial<{ kind: Kind; phases: Phase[] }>) => send({ type: 'plan', plan: { kind: d.kind ?? 'P', phases: ph, ...p } });
  const edit = (k: PhaseKey, p: Partial<Phase>) => plan({ phases: ph.map(x => x.k === k ? { ...x, ...p } : x) });
  const addPhase = (k: PhaseKey) => plan({ phases: ORDER.flatMap(o => o === k ? [{ k, venue: '', at: slot(ph, k), crew: [] }] : ph.filter(x => x.k === o)) });
  const dropPhase = async (k: PhaseKey) => {
    if (await ask(`Remove the ${PHASES[k].toLowerCase()}?`, 'It comes off the drive with its venue, time and volunteers. You can add it again until the interviews begin.', 'Remove phase', true)) plan({ phases: ph.filter(x => x.k !== k) });
  };
  const missing = canAdd(d) ? ORDER.filter(k => !ph.some(p => p.k === k)) : [];
  const done = st.filter(s => s === 'Done').length;
  const li = Math.max(0, st.findLastIndex(s => s !== 'Upcoming')); // the latest phase that has begun, else the next one
  const [roster, showRoster] = useSheet(); // the uploaded list, with how each did at every phase so far
  // a phase's venue and time are edited in a box from the gear on its card, and kept only on Save
  const [box, openBox] = useSheet(), [ed, setEd] = useState<Phase | null>(null);
  const settle = (p: Phase) => { setEd(p); openBox() };
  const list = d.pool ?? d.students, camp = (c: string) => list.filter(x => x.campus === c).length;
  const days = [...new Set(ph.map(p => p.at.slice(0, 10)).filter(Boolean))], span = days.length > 1 ? `${when(days[0])} – ${when(days.at(-1)!)}` : when(days[0] ?? '');
  const people = d.pool && (st[0] === 'Upcoming' || st[0] === 'Today') ? showRoster : undefined; // the list, from the first phase until it starts
  const state = d.status === 'done' || done === ph.length ? ['Completed', ''] : st.includes('Live') || d.status === 'live' ? ['Live', 'ok live'] : st.includes('Today') ? ['Today', 'warn'] : ['Upcoming', ''];
  return (
    <div className="app">
      <TopBar title={d.company} badge={<span className={`pill hide-sm ${state[1]}`}>{state[0]}</span>}>
        {missing.length > 0 && <More label="Add a phase" className="sm" down items={missing.map(k => [<><Icon n={PICON[k]} />{PHASES[k]}</>, () => addPhase(k)])}><Icon n="plus" s={14} />Add phase</More>}
        <button className="icon ghost" onClick={onDelete} title="Delete this drive" aria-label="Delete this drive"><Icon n="trash" /></button>
        <DeskMenu />
      </TopBar>
      <main className="dd">
        <div className="dd-in">
          <PageHead title={d.company} eyebrow={d.kind && KINDS[d.kind]} meta={<div className="pmeta">
            <span><Icon n="calendar" s={14} />{span}</span>
            <span><Icon n="users" s={14} />{list.length} students{camp('BLR') + camp('MPL') > 0 && <span className="faint">BLR {camp('BLR')} · MPL {camp('MPL')}</span>}</span>
            <span><Icon n="check" s={14} />{done} of {ph.length} phase{ph.length === 1 ? '' : 's'} done</span>
          </div>}>
            <div className="row">
              {d.pool && <button onClick={showRoster}><Icon n="roll" />Students</button>}
              {d.status === 'live' && d.attendance && <button className="primary" onClick={open}>Open board<Icon n="right" /></button>}
            </div>
          </PageHead>

          {d.status === 'done' && <><h3 className="sect-t">Report</h3><Summary d={d} /></>}{/* the interviews' report, up top once the drive is over */}

          <h3 className="sect-t">Phases</h3>
          <ol className="tl" style={{ '--n': ph.length } as React.CSSProperties}>
            {ph.map((p, i) => (
              <li key={p.k} className={st[i] === 'Done' ? 'done' : st[i] === 'Live' ? 'live' : i === li ? 'cur' : ''}>
                <span className="ph-mark" aria-hidden>{st[i] === 'Done' ? <Icon n="check" s={15} /> : <Icon n={PICON[p.k]} s={16} />}</span>
                <div><b>{PHASES[p.k]}</b><small>{ran(d, p, st[i])}</small></div>
              </li>
            ))}
          </ol>
          <div className={`phs${ph.length === 1 ? ' one' : ''}`} style={{ '--n': ph.length } as React.CSSProperties}>
            {ph.map((p, i) => (
              <PhaseCard key={p.k} d={d} p={p} s={st[i]}
                settle={() => settle(p)} drop={ph.length > 1 && removable(d, st[i]) ? () => dropPhase(p.k) : undefined} crew={crew => edit(p.k, { crew })}>
                {p.k === 'int' ? <Interviews d={d} p={p} s={st[i]} open={open} send={send} wait={st.slice(0, i).some(x => x !== 'Done')} />
                  : <Turnout d={d} p={p} s={st[i]} send={send} attend={() => attend(p)} people={i ? undefined : people} wait={st.slice(0, i).some(x => x !== 'Done')} />}
              </PhaseCard>
            ))}
          </div>
        </div>
        <Roster d={d} sheet={roster} />
        <dialog ref={box} className="ask" onClose={() => setEd(null)}>
          {ed && <form method="dialog" onSubmit={() => edit(ed.k, { venue: ed.venue.trim(), at: ed.at })}>
            <h3>{PHASES[ed.k]}</h3>
            <label className="field">Venue<input list="venues" value={ed.venue} maxLength={80} placeholder="Type a place, or pick one" onChange={e => setEd({ ...ed, venue: e.target.value })} /></label>
            <datalist id="venues">{venuesOf(ed.k).map(o => <option key={o} value={o} />)}</datalist>
            <label className="field">Date and time<input type="datetime-local" required {...around(ph, ph.findIndex(x => x.k === ed.k))} value={ed.at} onChange={e => setEd({ ...ed, at: e.target.value })} /></label>
            <div className="row"><div className="sp" /><button type="button" onClick={() => box.current?.close()}>Cancel</button><button className="primary">Save</button></div>
          </form>}
        </dialog>
      </main>
    </div>
  );
}

// One phase's column: where, when and who, then (children) its attendance or interviews, with their option buttons
// at the bottom. A drive with a single phase gets one wide card, the two halves side by side.
function PhaseCard({ d, p, s, settle, drop, crew, children }: {
  d: Drive; p: Phase; s: PhaseState; settle: () => void; drop?: () => void; crew: (c: string[]) => void; children: React.ReactNode;
}) {
  const name = PHASES[p.k];
  return (
    <section className={`ph-card${s === 'Live' ? ' live' : ''}`}>
        <header className="ph-h">
          <div><h2>{name}<span className={`pill ${TONE[s]}`}>{s}</span></h2><p className="meta">{lead(d, p, s)}</p></div>
          {s !== 'Done' && <button className="icon ghost" onClick={settle} title="Edit the venue and time" aria-label={`Edit the ${name.toLowerCase()}'s venue and time`}><Icon n="settings" /></button>}{/* locked once over */}
          {drop && <More label={`More for the ${name.toLowerCase()}`} down items={[[<><Icon n="trash" />Remove phase</>, drop]]} />}
        </header>
        <div className="ph-b">
          <dl className="ph-dl">
            <div><dt>Venue</dt><dd>{p.venue || <span className="faint">Not set yet</span>}</dd></div>
            <div><dt>When</dt><dd>{ran(d, p, s)}</dd></div>
            <div><dt>Volunteers</dt><dd><Crew names={p.crew} onChange={crew} /></dd></div>
          </dl>
          {children}
        </div>
    </section>
  );
}

// Ends a live talk or test after asking: its attendance becomes final, and whoever missed it isn't eligible after it.
export async function endPhase(d: Drive, p: Phase, send: Send) {
  const off = Object.keys(p.roll ?? {}).length, what = SHORT[p.k];
  if (!await ask(`End the ${what}?`, p.roll
    ? `Attendance is saved: ${eligible(d, p.k).length - off} present, ${off} absent. Students absent from the ${what} can't take part in the phases after it unless you make them eligible.`
    : `No attendance was taken, so every student stays eligible for the phases after it.`, `End ${what}`, true)) return false;
  await send({ type: 'endPhase', k: p.k });
  return true;
}

// A talk's or test's side of its card: while it is live, its attendance and ending it; once over, who came and who
// missed it, with a way to let anyone who missed it into the phases after it.
function Turnout({ d, p, s, send, attend, people, wait }: { d: Drive; p: Phase; s: PhaseState; send: Send; attend: () => void; people?: () => void; wait: boolean }) {
  const [sheet, show] = useSheet();
  const all = eligible(d, p.k), roll = p.roll, off = all.filter(x => roll && x.id in roll), what = SHORT[p.k];
  const virtual = isVirtual(p.venue); // attendance is optional; without it everyone stays eligible
  const head = <div className="ph-xh">Attendance{virtual && s !== 'Done' && <span className="tag">Optional · virtual</span>}</div>;
  const counts = <Mini items={[['Eligible', all.length], ['Present', all.length - off.length, 'ok'], ['Absent', off.length, 'abs']]} />;
  // a PPT's attendance opens at its time; an OA's whenever, its time only a reference, once the phases before it are over
  if (s === 'Live' || (p.k === 'oa' && s !== 'Done')) return (
    <div className="ph-x">{head}
      {roll && counts}
      <p className="meta">{roll ? '' : virtual ? `${all.length} eligible students. Without attendance, all of them stay eligible.` : `${all.length} eligible students. Take attendance before ending the ${what}.`}{p.k === 'ppt' ? ' It ends by itself two hours after it starts.' : !roll && wait ? ' Attendance opens once the earlier phases end.' : ' It runs until you end it.'}</p>
      <div className="ph-acts">
        {people && !roll && <button onClick={people}><Icon n="roll" />View students</button>}
        <button className="danger soft" disabled={!roll && !virtual} title={!roll && !virtual ? 'Take attendance first' : undefined} onClick={() => endPhase(d, p, send)}><Icon n="flag" />End {what}</button>
        <button className="primary" disabled={!roll && wait} title={!roll && wait ? 'The earlier phases decide who takes it: end them first' : undefined} onClick={attend}><Icon n="roll" />{roll ? 'Continue attendance' : 'Take attendance'}</button>
      </div>
    </div>
  );
  if (s !== 'Done') return <div className="ph-x">{head}<p className="meta">{all.length} eligible students. Attendance opens when the {what} starts.</p>
    {people && <div className="ph-acts"><button onClick={people}><Icon n="roll" />View students</button></div>}</div>;
  if (!roll) return <div className="ph-x">{head}<p className="meta">No attendance was taken, so all {all.length} students stay eligible.</p></div>;
  return (
    <div className="ph-x">{head}
      {counts}
      <div className="ph-acts"><button onClick={show}><Icon n="eye" />View attendance</button></div>
      <Sheet sheet={sheet} title={`${PHASES[p.k]} attendance`} count={all.length} tools={<button className="sm" onClick={() => exportAttendance(d, p)}><Icon n="download" s={14} />Download</button>}>
        <AttendanceTable all={all} absent={off} why={x => roll[x.id]} edit={(x, reason) => send({ type: 'reason', k: p.k, id: x.id, reason })}
          note="they can’t take part after it unless made eligible" act={x => p.excused?.includes(x.id) ? <span className="pill ok">Eligible</span>
            : <More className="icon sm ghost" label={`More for ${x.name}`} items={[[<><Icon n="check" />Make eligible</>, () => send({ type: 'excuse', k: p.k, id: x.id })]]} />} />
      </Sheet>
    </div>
  );
}

// An attendance sheet: everyone who was on the roll, present first, then absent with their reason (editable) and act,
// what can be done about each absent one
function AttendanceTable({ all, absent, why, edit, act, note }: {
  all: Pupil[]; absent: Pupil[]; why: (x: Pupil) => string; edit: (x: Pupil, reason: string) => void; act?: (x: Pupil) => React.ReactNode; note?: string;
}) {
  return (
    <div className="panel att"><div className="scroll"><table>
      <thead><tr><th className="hide-sm">#</th><th className="hide-sm">Reg. no.</th><th>Name</th><th className="hide-sm">Campus</th><th>Reason for absence</th><th /></tr></thead>
      <tbody>
        <tr className="sect ok"><td colSpan={6}>Present · {all.length - absent.length}</td></tr>
        {all.filter(x => !absent.includes(x)).map(x => <Who key={x.id} x={x} i={all.indexOf(x)} />)}
        <tr className="sect"><td colSpan={6}>Absent · {absent.length}{absent.length > 0 && note && <span> · {note}</span>}</td></tr>
        {absent.map(x => <Who key={x.id} x={x} i={all.indexOf(x)} why={why(x) ?? ''} edit={reason => edit(x, reason)}>{act?.(x)}</Who>)}
      </tbody>
    </table></div></div>
  );
}

// Everyone on the list uploaded with the drive, as in the file, with how each did at every phase that took attendance.
function Roster({ d, sheet }: { d: Drive; sheet: React.RefObject<HTMLDialogElement | null> }) {
  const [q, setQ] = useState('');
  const pool = d.pool ?? [], took = phasesOf(d).filter(p => p.roll);
  const shown = pool.map((x, i) => ({ x, i })).filter(({ x }) => `${x.reg} ${x.name}`.toLowerCase().includes(q.toLowerCase()));
  const may = new Map(took.map(p => [p.k, new Set(eligible(d, p.k).map(x => x.id))])); // who was on each phase's roll
  const how = (p: Phase, x: Pupil) => !may.get(p.k)!.has(x.id) ? <span className="meta">Not eligible</span>
    : x.id in p.roll! ? <span className="no">Absent{p.excused?.includes(x.id) && ', made eligible'}</span> : <span className="ok">Present</span>;
  return (
    <Sheet sheet={sheet} title="Students" count={pool.length}>
      <div className="panel roster">
        <div className="panel-bar"><label className="search w240"><Icon n="search" s={14} /><input type="search" placeholder="Search by name or reg. no." value={q} onChange={e => setQ(e.target.value)} aria-label="Search students" /></label><span className="meta">{shown.length} shown</span></div>
        <div className="scroll"><table>
          <thead><tr><th>#</th><th>Reg. no.</th><th>Name</th><th>Campus</th>{took.map(p => <th key={p.k}>{SHORT[p.k]}</th>)}</tr></thead>
          <tbody>
            {shown.map(({ x, i }) => (
              <tr key={x.id}><td className="num">{i + 1}</td><td className="reg">{x.reg}</td><td><b>{x.name}</b></td><td><Camp c={x.campus} /></td>{took.map(p => <td key={p.k}>{how(p, x)}</td>)}</tr>
            ))}
            {!shown.length && <tr><td colSpan={4 + took.length} className="empty">No students</td></tr>}
          </tbody>
        </table></div>
      </div>
    </Sheet>
  );
}

// one student in an attendance sheet; children: what can be done about them
const Who = ({ x, i, why, edit, children }: { x: Pupil; i: number; why?: string; edit?: (reason: string) => void; children?: React.ReactNode }) => (
  <tr className={why != null ? 'abs' : ''}>
    <td className="num hide-sm">{i + 1}</td><td className="reg hide-sm">{x.reg}</td><td><b>{x.name}</b></td>
    <td className="hide-sm"><Camp c={x.campus} /></td>
    <td className="meta">{edit ? <Field value={why ?? ''} placeholder="Add a reason" maxLength={200} aria-label={`Why ${x.name} was absent`} onSave={edit} /> : why}</td><td className="act">{children}</td>
  </tr>
);

// The interviews' side of their card: their rounds and cabins, each edited in a small window any time before the end;
// on the day, the board (opening it starts them); while live, their numbers and ending them, which finishes the drive.
function Interviews({ d, p, s, open, send, wait }: { d: Drive; p: Phase; s: PhaseState; open: () => void; send: Send; wait: boolean }) {
  const [box, openBox] = useSheet(), [sheet, showSheet] = useSheet();
  const [what, setWhat] = useState<'Rounds' | 'Cabins'>('Rounds');
  const show = (w: typeof what) => { setWhat(w); openBox() };
  const n = (f: (x: Drive['students'][number]) => boolean) => d.students.filter(f).length;
  const planned = d.status === 'planned', ready = d.rooms.length > 0;
  // attendance opens once the phases before end (of those present at them) and stays open until the interviews start,
  // which takes the rounds and cabins; the interviews themselves begin with the first student called
  const opened = d.status === 'live' && !d.attendance, off = Object.keys(d.roll ?? {}).length;
  const gone = d.students.filter(x => x.status === 'absent' && absentAt(d, x) === 'Interview attendance'); // missed their attendance, not a later round
  const go = () => { open(); if (planned) send({ type: 'start' }) };
  const end = async () => {
    if (await ask('End the interviews?', 'This finishes the drive: it moves to the calendar as completed, with its report. You can reopen it later if needed.', 'End interviews', true)) send({ type: 'finish' });
  };
  const running = d.status === 'live' && !!d.attendance, free = d.rooms.filter(r => !occ(d, r)).length, named = d.rooms.filter(r => r.panel).length;
  const blr = n(x => x.status === 'selected' && x.campus === 'BLR');
  if (d.status === 'done') return (
    <div className="ph-x"><div className="ph-xh">Attendance</div>
      <Mini items={[['Eligible', d.students.length], ['Present', d.students.length - gone.length, 'ok'], ['Absent', gone.length, 'abs']]} />
      <div className="ph-acts"><button onClick={showSheet}><Icon n="eye" />View attendance</button></div>
      <Sheet sheet={sheet} title="Interviews attendance" count={d.students.length}>
        <AttendanceTable all={d.students} absent={gone} why={x => (x as Drive['students'][number]).reason ?? ''} edit={(x, reason) => send({ type: 'reason', id: x.id, reason })} />
      </Sheet>
    </div>
  );
  return (
    <div className="ph-x">
      {running && <>
        <div className="ph-xh">Right now</div>
        <Mini items={[['Present', n(x => x.status !== 'absent')], ['In cabins', n(x => x.status === 'in'), 'in'], ['Awaiting', n(x => x.status === 'pending'), 'pend'],
          ['Selected', <>{n(x => x.status === 'selected')}{blr > 0 && <small>{blr} BLR</small>}</>, 'ok'], ['Rejected', n(x => x.status === 'rejected'), 'no'], ['Absent', n(x => x.status === 'absent'), 'abs']]} />
      </>}
      <div className="ph-xh">Rounds and cabins</div>
      <div className="ivset">
        <div><span><b>Rounds</b><small>{d.rounds.join(' · ')}</small></span>
          <Stepper label="Rounds" value={d.rounds.length} min={1} max={10} less={() => send({ type: 'delRound' })} more={() => send({ type: 'addRound' })} />
          <button className="sm" onClick={() => show('Rounds')} title="Name the rounds">Edit</button></div>
        <div><span><b>Cabins</b><small>{!ready ? 'None yet' : running ? `${free} free right now` : `${named} of ${d.rooms.length} with an interviewer`}</small></span>
          <Stepper label="Cabins" value={d.rooms.length} min={0} max={60} less={() => send({ type: 'delRoom', room: d.rooms[d.rooms.length - 1].id })} more={() => send({ type: 'addRoom' })} />
          <button className="sm" disabled={!ready} onClick={() => show('Cabins')} title="Name the interviewers and pick their rounds">Edit</button></div>
      </div>
      {!d.attendance && <p className="meta">{opened ? `${d.students.length - off} present · ${off} absent so far. ` : d.pool ? `${eligible(d, 'int').length} eligible students. ` : ''}{wait && planned ? 'Attendance opens once the earlier phases end.'
        : opened ? 'Confirm the attendance to open the board.' : 'Take attendance whenever the students are in.'}</p>}
      <div className="ph-acts">
        {!d.attendance
          ? <>
            <button disabled title="Confirm the attendance first">Open board<Icon n="right" /></button>
            <button className="primary" disabled={planned && wait} title={planned && wait ? 'The earlier phases decide who takes part: end them first' : undefined} onClick={go}><Icon n="roll" />{opened ? 'Continue attendance' : 'Take attendance'}</button>
          </>
          : <>
            <button className="danger soft" disabled={!called(d)} title={!called(d) ? 'The interviews start with the first student called' : undefined} onClick={end}><Icon n="flag" />End interviews</button>
            <button className="primary" onClick={go}>Open board<Icon n="right" /></button>
          </>}
      </div>
      <Sheet sheet={box} className="small" title={what} count={what === 'Rounds' ? d.rounds.length : d.rooms.length}>
        <div className="sheet-b">
          {what === 'Rounds' ? <RoundsEdit d={d} send={send} /> : <CabinsEdit d={d} send={send} />}
        </div>
        <div className="wfoot"><div className="sp" /><button className="primary" onClick={() => box.current?.close()}>Done</button></div>
      </Sheet>
    </div>
  );
}
