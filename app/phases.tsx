'use client';
import { Children, useRef, useState } from 'react';
import { KINDS, PHASES, absentAt, waitsFor, chosen, fromPrev, prevOf, called, lead as isLead, occ, canAdd, endOf, startOf, eligible, isVirtual, venuesOf, localDate, phasesOf, regOf, removable, shortOf, titleOf, type Ask, type Drive, type Kind, type Member, type Phase, type PhaseId, type PhaseKey, type PhaseState, type Pupil, phaseStates } from '@/lib/drive';
import { Camp } from './board';
import { CabinsEdit, RoundsEdit, Summary, Venue, exportAttendance, readTable } from './panels';
import { Av, DeskMenu, Field, Icon, More, PageHead, Sheet, Stepper, TopBar, ask, nameOf, post, tm, toast, useNow, usePeople, useSheet, when, type Send } from './ui';
// the timeline's time: a PPT or OA from its set time, the interviews from the first call; once over, start – end
const ran = (d: Drive, p: Phase, s: PhaseState) => {
  if (s === 'Upcoming' || s === 'Today') return when(p.at);
  const int = p.k === 'int', end = int ? d.endedAt : endOf(p), start = int && called(d) ? d.startedAt : startOf(p);
  const at = `${new Date(start).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} · ${tm(start)}`;
  return s === 'Done' && end && isFinite(end) ? `${at} – ${tm(end)}` : at;
};

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (t: number) => { const z = new Date(t); return `${localDate(t)}T${pad(z.getHours())}:${pad(z.getMinutes())}` };
// the earliest and latest a phase's time can be: the talk before every other phase
const around = (ph: Phase[], i: number) => ph[i]?.k === 'ppt' ? { max: ph.slice(1).map(p => p.at).filter(Boolean).sort()[0] || undefined }
  : { min: ph[0]?.k === 'ppt' ? ph[0].at || undefined : undefined }; // only the talk has to come first
// a time for a phase added later at position i that keeps the order: a day before the next phase, or a day after the
// one before, or halfway between them when they are closer than that
function slot(ph: Phase[], i: number) {
  const t = (p?: Phase) => p && Date.parse(p.at.length > 10 ? p.at : `${p.at}T09:00`);
  const prev = t(ph[i - 1]), next = t(ph[i]);
  let at = next ? next - 864e5 : prev! + 864e5;
  if (prev && next && at <= prev) at = (prev + next) / 2;
  return stamp(at);
}

// One column per phase in the drive: where and when it happens, and who volunteers at it.
// The time pickers keep the phases in order: none before the one ahead of it.
export function PhaseColumns({ phases, onChange }: { phases: Phase[]; onChange: (id: PhaseId, p: Partial<Phase>) => void }) {
  const d = { phases } as Drive; // for the phases' names
  return (
    <div className="pcols" style={{ '--n': byKind(phases).length } as React.CSSProperties}>
      {byKind(phases).map(c => <div key={c[0].p.k} className="pcol-k">{c.map(({ p, i }) => ( // several OAs stack in one column
        <section key={p.id} className="pcol">
          <h3><span className="pico"><Icon n={PICON[p.k]} s={15} /></span>{titleOf(d, p)}</h3>
          <label className="field">Name<input value={p.name ?? ''} maxLength={40} placeholder={titleOf(d, { ...p, name: '' })} onChange={e => onChange(p.id, { name: e.target.value })} /></label>
          <label className="field">Venue<Venue value={p.venue} options={venuesOf(p.k)} onSave={venue => onChange(p.id, { venue })} /></label>
          <label className="field">Date and time<input type="datetime-local" {...around(phases, i)} value={p.at} onChange={e => onChange(p.id, { at: e.target.value })} /></label>
          <div className="field">Volunteers<Crew names={p.crew} onChange={crew => onChange(p.id, { crew })} /></div>
        </section>
      ))}</div>)}
    </div>
  );
}

// A phase's volunteers (usernames): a chip per member, marked when it's you. With onChange (seniors) × takes someone off
// and + Add offers the members not on it yet; names from before accounts don't show. children: more chips or buttons.
export function Crew({ names, onChange, children }: { names: string[]; onChange?: (n: string[]) => void; children?: React.ReactNode }) {
  const p = usePeople(), me = p?.me?.user;
  const on = names.filter(u => p?.members.some(m => m.user === u));
  const free = (p?.members ?? []).filter(m => m.role !== 'admin' && !names.includes(m.user));
  return (
    <div className="crew">
      {on.map(u => (
        <span key={u} className={`vchip${u === me ? ' me' : ''}`}><Av n={nameOf(p, u)} />{nameOf(p, u)}{u === me && <small>You</small>}
          {onChange && <button className="icon ghost" onClick={() => onChange(names.filter(x => x !== u))} title={`Remove ${nameOf(p, u)}`} aria-label={`Remove ${nameOf(p, u)}`}><Icon n="x" s={12} /></button>}
        </span>
      ))}
      {children}
      {onChange && free.length > 0 && <More label="Add a volunteer" className="sm ghost vadd" down items={free.map(m => [<><Av n={m.name} />{m.name}</>, () => onChange([...names, m.user])])}>
        <Icon n="plus" s={13} />{on.length ? 'Add' : 'Add volunteer'}</More>}
      {onChange && !free.length && !on.length && p && <span className="faint">Add members on the Accounts page to pick volunteers</span>}
      {!onChange && !on.length && !Children.toArray(children).length && <span className="faint">None yet</span>}
    </div>
  );
}

// A phase's volunteers on its card. Seniors manage them and approve or decline who asked; a junior asks to volunteer at
// any phase that isn't over (withdraws while it waits, asks again if declined). Asking alone lets them edit nothing: only
// being on the volunteers does. Asking needs the internet: requests live in the shared copy.
function Helpers({ d, p, s, me, asks, onChange }: { d: Drive; p: Phase; s: PhaseState; me: Member | null; asks: Ask[]; onChange: (c: string[]) => void }) {
  const people = usePeople(), boss = isLead(me), mine = asks.find(a => a.k === p.id && a.user === me?.user);
  const waiting = boss ? asks.filter(a => a.k === p.id && a.status === 'pending' && !p.crew.includes(a.user)) : [];
  const act = (what: 'ask' | 'withdraw' | 'approve' | 'deny', user?: string) =>
    post('/api/volunteers', { drive: d.id, k: p.id, what, user }).then(j => { if (j.msg) toast(j.msg) }, () => {});
  const open = d.status !== 'done' && s !== 'Done';
  const name = (u: string) => nameOf(people, u);
  return (
    <Crew names={p.crew} onChange={boss ? onChange : undefined}>
      {waiting.map(a => (
        <span key={a.user} className="vchip req" title={`${name(a.user)} asked to volunteer`}><Av n={name(a.user)} />{name(a.user)}<small>Asked</small>
          <button className="icon ghost yes" onClick={() => act('approve', a.user)} title="Approve" aria-label={`Approve ${name(a.user)}`}><Icon n="check" s={13} /></button>
          <button className="icon ghost" onClick={() => act('deny', a.user)} title="Decline" aria-label={`Decline ${name(a.user)}`}><Icon n="x" s={12} /></button>
        </span>
      ))}
      {!boss && me && !p.crew.includes(me.user) && (
        mine?.status === 'pending' ? <span className="vme">Requested<button className="link" onClick={() => act('withdraw')}>Withdraw</button></span>
        : mine?.status === 'denied' ? <span className="vme">Not approved{open && <button className="link" onClick={() => act('ask')}>Ask again</button>}</span>
        : open && <button className="sm vask" onClick={() => act('ask')}><Icon n="hand" s={14} />Volunteer</button>)}
    </Crew>
  );
}

// the phases by kind, in order: the talk, the OAs (stacked in one column), the interviews; each with its index in the drive
const byKind = (ph: Phase[]) => (['ppt', 'oa', 'int'] as PhaseKey[]).map(k => ph.flatMap((p, i) => p.k === k ? [{ p, i }] : [])).filter(c => c.length);

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
  if (s === 'Live') return p.k !== 'int' ? `Live since ${tm(startOf(p))}` : called(d) ? `Running since ${tm(d.startedAt)}` : d.attendance ? 'Attendance taken, no one called yet' : 'Attendance open';
  if (days < 0) return `Set for ${when(p.at.slice(0, 10))}`; // interviews not begun after their date: their time was only a reference
  if (!days) return p.at.length > 10 ? `Today at ${tm(new Date(p.at).getTime())}` : 'Today';
  return days === 1 ? 'Tomorrow' : `In ${days} days`;
}

// The whole drive: a timeline of its phases, and under each one a column with where, when, who and how it went.
// Phases it doesn't have yet are added from the top bar; its name and type of offer are edited from the gear there.
// can: the phases the signed-in member runs (a senior every one, a junior those they volunteer at); the rest is read-only
// for them (the students too), with Volunteer on the phases still ahead. Only seniors add, remove or delete.
export function DriveDash({ d, send, onDelete, open, attend, me, can, asks }: {
  d: Drive; send: Send; onDelete: () => void; open: () => void; attend: (p: Phase) => void; me: Member | null; can: Partial<Record<PhaseId, boolean>>; asks: Ask[];
}) {
  const boss = isLead(me);
  const ph = phasesOf(d), st = phaseStates(d, useNow()); // states move on with the clock
  const plan = (p: Partial<{ kind: Kind; phases: Phase[] }>) => send({ type: 'plan', plan: { kind: d.kind ?? 'P', phases: ph, ...p } });
  const waits = (i: number) => waitsFor(d, i).some(g => st[ph.findIndex(x => x.id === g.id)] !== 'Done'); // its attendance opens once these end
  const change = (id: PhaseId, p: Partial<Phase>) => plan({ phases: ph.map(x => x.id === id ? { ...x, ...p } : x) });
  // a new phase goes in its place: the talk first, an OA after the other OAs, the interviews last (the engine gives it an id)
  const addPhase = (k: PhaseKey) => {
    const i = k === 'ppt' ? 0 : k === 'int' ? ph.length : ph.filter(x => x.k !== 'int').length;
    plan({ phases: ph.toSpliced(i, 0, { id: '', k, venue: '', at: slot(ph, i), crew: [] }) });
  };
  const dropPhase = async (p: Phase) => {
    if (await ask(`Remove the ${shortOf(d, p)}?`, 'It comes off the drive with its venue, time, volunteers and shortlist. You can add it again until the interviews begin.', 'Remove phase', true)) plan({ phases: ph.filter(x => x.id !== p.id) });
  };
  // a talk and the interviews once each, any number of OAs
  const missing = boss && canAdd(d) ? (['ppt', 'oa', 'int'] as PhaseKey[]).filter(k => k === 'oa' ? ph.filter(p => p.k === 'oa').length < 9 : !ph.some(p => p.k === k)) : [];
  const done = st.filter(s => s === 'Done').length;
  const li = Math.max(0, st.findLastIndex(s => s !== 'Upcoming')), cols = byKind(ph); // li: the latest phase that has begun, else the next one
  const [roster, showRoster] = useSheet(); // the uploaded list, with how each did at every phase so far
  // a phase's venue and time are edited in a box from the gear on its card, and kept only on Save
  const [box, openBox] = useSheet(), [ed, setEd] = useState<Phase | null>(null);
  const settle = (p: Phase) => { setEd(p); openBox() };
  const [details, openDetails] = useSheet();
  const list = d.pool ?? d.students, camp = (c: string) => list.filter(x => x.campus === c).length;
  const days = [...new Set(ph.map(p => p.at.slice(0, 10)).filter(Boolean))], span = days.length > 1 ? `${when(days[0])} – ${when(days.at(-1)!)}` : when(days[0] ?? '');
  const people = d.pool && (st[0] === 'Upcoming' || st[0] === 'Today') ? showRoster : undefined; // the list, from the first phase until it starts
  const state = d.status === 'done' || done === ph.length ? ['Completed', ''] : st.includes('Live') || d.status === 'live' ? ['Live', 'ok live'] : st.includes('Today') ? ['Today', 'warn'] : ['Upcoming', ''];
  return (
    <div className="app">
      <TopBar title={d.company} badge={<span className={`pill hide-sm ${state[1]}`}>{state[0]}</span>}>
        {missing.length > 0 && <More label="Add a phase" className="sm" down items={missing.map(k => [<><Icon n={PICON[k]} />{k === 'oa' && ph.some(p => p.k === 'oa') ? 'Another online assessment' : PHASES[k]}</>, () => addPhase(k)])}><Icon n="plus" s={14} />Add phase</More>}
        {boss && <button className="icon ghost" onClick={openDetails} title="Drive details" aria-label="Edit the drive's details"><Icon n="settings" /></button>}
        {boss && <button className="icon ghost" onClick={onDelete} title="Delete this drive" aria-label="Delete this drive"><Icon n="trash" /></button>}
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
              {can.int && d.status === 'live' && d.attendance && <button className="primary" onClick={open}>Open board<Icon n="right" /></button>}
            </div>
          </PageHead>

          {d.status === 'done' && <><h3 className="sect-t">Report</h3><Summary d={d} /></>}{/* the interviews' report, up top once the drive is over */}

          <h3 className="sect-t">Phases</h3>
          <ol className="tl" style={{ '--n': cols.length } as React.CSSProperties}>
            {cols.map(c => { // one step per column: several OAs share theirs
              const s = c.map(x => st[x.i]), [{ p, i }] = c;
              return <li key={p.id} className={s.every(x => x === 'Done') ? 'done' : s.includes('Live') ? 'live' : c.some(x => x.i === li) ? 'cur' : ''}>
                <span className="ph-mark" aria-hidden>{s.every(x => x === 'Done') ? <Icon n="check" s={15} /> : <Icon n={PICON[p.k]} s={16} />}</span>
                <div><b>{c.length > 1 ? 'Online assessments' : titleOf(d, p)}</b><small>{c.length > 1 ? c.map(x => shortOf(d, x.p)).join(' · ') : ran(d, p, st[i])}</small></div>
              </li>;
            })}
          </ol>
          <div className={`phs${ph.length === 1 ? ' one' : ''}`} style={{ '--n': cols.length } as React.CSSProperties}>
            {cols.map(c => <div key={c[0].p.k} className="ph-col">{c.map(({ p, i }) => ( // several OAs stack in one column
              <PhaseCard key={p.id} d={d} p={p} s={st[i]} settle={can[p.id] ? () => settle(p) : undefined}
                drop={boss && ph.length > 1 && removable(d, st[i]) ? () => dropPhase(p) : undefined}
                helpers={<Helpers d={d} p={p} s={st[i]} me={me} asks={asks} onChange={crew => change(p.id, { crew })} />}
                source={p.k !== 'ppt' && <Source d={d} p={p} edit={!!can[p.id]} send={send} />}>
                {p.k === 'int' ? <Interviews d={d} p={p} s={st[i]} open={open} send={send} edit={!!can[p.id]} wait={waits(i)} />
                  : <Turnout d={d} p={p} s={st[i]} send={send} edit={!!can[p.id]} attend={() => attend(p)} people={i ? undefined : people} wait={waits(i)} />}
              </PhaseCard>
            ))}</div>)}
          </div>
        </div>
        <Roster d={d} sheet={roster} />
        <DriveDetails d={d} sheet={details} send={send} />
        <dialog ref={box} className="ask" onClose={() => setEd(null)}>
          {ed && <form method="dialog" onSubmit={() => change(ed.id, { name: ed.name?.trim() || undefined, venue: ed.venue.trim(), at: ed.at })}>
            <h3>{titleOf(d, { ...ed, name: '' })}</h3>
            <label className="field">Name<input value={ed.name ?? ''} maxLength={40} placeholder={titleOf(d, { ...ed, name: '' })} onChange={e => setEd({ ...ed, name: e.target.value })} />
              <small className="meta">How it shows everywhere. Leave it empty for the usual name.</small></label>
            <label className="field">Venue<input list="venues" value={ed.venue} maxLength={80} placeholder="Type a place, or pick one" onChange={e => setEd({ ...ed, venue: e.target.value })} /></label>
            <datalist id="venues">{venuesOf(ed.k).map(o => <option key={o} value={o} />)}</datalist>
            <label className="field">Date and time<input type="datetime-local" required {...around(ph, ph.findIndex(x => x.id === ed.id))} value={ed.at} onChange={e => setEd({ ...ed, at: e.target.value })} /></label>
            <div className="row"><div className="sp" /><button type="button" onClick={() => box.current?.close()}>Cancel</button><button className="primary">Save</button></div>
          </form>}
        </dialog>
      </main>
    </div>
  );
}

// The drive's own details, from the gear in its top bar (seniors): the company's name and the type of offer.
function DriveDetails({ d, sheet, send }: { d: Drive; sheet: React.RefObject<HTMLDialogElement | null>; send: Send }) {
  const [company, setCompany] = useState(d.company), [kind, setKind] = useState<Kind>(d.kind ?? 'P');
  return (
    <dialog ref={sheet} className="ask" onClose={() => { setCompany(d.company); setKind(d.kind ?? 'P') }}>
      <form method="dialog" onSubmit={() => send({ type: 'details', company, kind })}>
        <h3>Drive details</h3>
        <label className="field">Company name<input required autoFocus maxLength={80} value={company} onChange={e => setCompany(e.target.value)} /></label>
        <div className="field">Type of drive
          <div className="seg kind" role="radiogroup" aria-label="Type of drive">
            {(Object.keys(KINDS) as Kind[]).map(k => <button type="button" key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{KINDS[k]}</button>)}
          </div>
        </div>
        <p className="meta">The phases&rsquo; names, venues and times are edited from the gear on each phase.</p>
        <div className="row"><div className="sp" /><button type="button" onClick={() => sheet.current?.close()}>Cancel</button><button className="primary">Save</button></div>
      </form>
    </dialog>
  );
}

// One phase's column: where, when and who (helpers: its volunteers), then (children) its attendance or interviews, with
// their option buttons at the bottom. A drive with a single phase gets one wide card, the two halves side by side.
// settle / drop: editing its venue and time, removing it (for those who run the drive).
function PhaseCard({ d, p, s, settle, drop, helpers, source, children }: {
  d: Drive; p: Phase; s: PhaseState; settle?: () => void; drop?: () => void; helpers: React.ReactNode; source?: React.ReactNode; children: React.ReactNode;
}) {
  const name = titleOf(d, p);
  return (
    <section className={`ph-card${s === 'Live' ? ' live' : ''}`}>
        <header className="ph-h">
          <div><h2>{name}<span className={`pill ${TONE[s]}`}>{s}</span></h2><p className="meta">{lead(d, p, s)}</p></div>
          {s !== 'Done' && settle && <button className="icon ghost" onClick={settle} title="Edit the name, venue and time" aria-label={`Edit the ${name}'s name, venue and time`}><Icon n="settings" /></button>}{/* locked once over */}
          {drop && <More label={`More for the ${name}`} down items={[[<><Icon n="trash" />Remove phase</>, drop]]} />}
        </header>
        <div className="ph-b">
          <dl className="ph-dl">
            <div><dt>Venue</dt><dd>{p.venue || <span className="faint">Not set yet</span>}</dd></div>
            <div><dt>When</dt><dd>{ran(d, p, s)}</dd></div>
            <div><dt>Volunteers</dt><dd>{helpers}</dd></div>
            {source && <div><dt>Students</dt><dd>{source}</dd></div>}
          </dl>
          {children}
        </div>
    </section>
  );
}

// Ends a live talk or test after asking: its attendance becomes final, and whoever missed it isn't eligible after it.
export async function endPhase(d: Drive, p: Phase, send: Send) {
  const off = Object.keys(p.roll ?? {}).length, what = shortOf(d, p);
  if (!await ask(`End the ${what}?`, p.roll
    ? `Attendance is saved: ${eligible(d, p.id).length - off} present, ${off} absent. Students absent from the ${what} can't take part in the phases after it unless you make them eligible.`
    : `No attendance was taken, so every student stays eligible for the phases after it.`, `End ${what}`, true)) return false;
  await send({ type: 'endPhase', k: p.id });
  return true;
}

// A talk's or test's side of its card: while it is live, its attendance and ending it; once over, who came and who
// missed it, with a way to let anyone who missed it into the phases after it.
function Turnout({ d, p, s, send, edit, attend, people, wait }: { d: Drive; p: Phase; s: PhaseState; send: Send; edit: boolean; attend: () => void; people?: () => void; wait: boolean }) {
  const [sheet, show] = useSheet();
  const all = eligible(d, p.id), roll = p.roll, off = all.filter(x => roll && x.id in roll), what = shortOf(d, p);
  const virtual = isVirtual(p.venue); // attendance is optional; without it everyone stays eligible
  const head = <div className="ph-xh">Attendance{virtual && s !== 'Done' && <span className="tag">Optional · virtual</span>}</div>;
  const counts = <Mini items={[['Eligible', all.length], ['Present', all.length - off.length, 'ok'], ['Absent', off.length, 'abs']]} />;
  // a PPT's attendance opens at its time; an OA's earlier too, once the phases before it are over. Either goes live, and
  // can be ended, only from its time
  const live = s === 'Live', today = p.at.slice(0, 10) === localDate(Date.now());
  const tail = p.k === 'ppt' ? ' It ends by itself two hours after it starts.' : !roll && wait ? ' Attendance opens once the earlier phases end.'
    : live ? ' It runs until you end it.' : ` It goes live ${today ? `at ${tm(startOf(p))}` : `on ${when(p.at)}`}, and can be ended from then.`;
  if (live || (p.k === 'oa' && s !== 'Done')) return (
    <div className="ph-x">{head}
      {roll && counts}
      <p className="meta">{roll ? '' : virtual ? `${all.length} eligible students. Without attendance, all of them stay eligible.` : `${all.length} eligible students. Take attendance before ending the ${what}.`}{tail}</p>
      <div className="ph-acts">
        {people && !roll && <button onClick={people}><Icon n="roll" />View students</button>}
        {edit && <>
          {live && <button className="danger soft" disabled={!roll && !virtual} title={!roll && !virtual ? 'Take attendance first' : undefined} onClick={() => endPhase(d, p, send)}><Icon n="flag" />End {what}</button>}
          <button className="primary" disabled={!roll && (wait || !chosen(p))} title={!roll && !chosen(p) ? 'Choose who takes it first, under Students above' : !roll && wait ? 'The earlier phases decide who takes it: end them first' : undefined} onClick={attend}><Icon n="roll" />{roll ? 'Continue attendance' : 'Take attendance'}</button>
        </>}
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
      <Sheet sheet={sheet} title={`${titleOf(d, p)} attendance`} count={all.length} tools={<button className="sm" onClick={() => exportAttendance(d, p)}><Icon n="download" s={14} />Download</button>}>
        <AttendanceTable all={all} absent={off} why={x => roll[x.id]} edit={edit ? (x, reason) => send({ type: 'reason', k: p.id, id: x.id, reason }) : undefined}
          note="they can’t take part after it unless made eligible" act={x => p.excused?.includes(x.id) ? <span className="pill ok">Eligible</span>
            : edit && <More className="icon sm ghost" label={`More for ${x.name}`} items={[[<><Icon n="check" />Make eligible</>, () => send({ type: 'excuse', k: p.id, id: x.id })]]} />} />
      </Sheet>
    </div>
  );
}

// An attendance sheet: everyone who was on the roll, present first, then absent with their reason (editable) and act,
// what can be done about each absent one
function AttendanceTable({ all, absent, why, edit, act, note }: {
  all: Pupil[]; absent: Pupil[]; why: (x: Pupil) => string; edit?: (x: Pupil, reason: string) => void; act?: (x: Pupil) => React.ReactNode; note?: string;
}) {
  return (
    <div className="panel att"><div className="scroll"><table>
      <thead><tr><th className="hide-sm">#</th><th className="hide-sm">Reg. no.</th><th>Name</th><th className="hide-sm">Campus</th><th>Reason for absence</th><th /></tr></thead>
      <tbody>
        <tr className="sect ok"><td colSpan={6}>Present · {all.length - absent.length}</td></tr>
        {all.filter(x => !absent.includes(x)).map(x => <Who key={x.id} x={x} i={all.indexOf(x)} />)}
        <tr className="sect"><td colSpan={6}>Absent · {absent.length}{absent.length > 0 && note && <span> · {note}</span>}</td></tr>
        {absent.map(x => <Who key={x.id} x={x} i={all.indexOf(x)} why={why(x) ?? ''} edit={edit && (reason => edit(x, reason))}>{act?.(x)}</Who>)}
      </tbody>
    </table></div></div>
  );
}

// Everyone on the list uploaded with the drive, as in the file, with how each did at every phase that took attendance.
function Roster({ d, sheet }: { d: Drive; sheet: React.RefObject<HTMLDialogElement | null> }) {
  const [q, setQ] = useState('');
  const pool = d.pool ?? [], took = phasesOf(d).filter(p => p.roll);
  const shown = pool.map((x, i) => ({ x, i })).filter(({ x }) => `${x.reg} ${x.name}`.toLowerCase().includes(q.toLowerCase()));
  const may = new Map(took.map(p => [p.id, new Set(eligible(d, p.id).map(x => x.id))])); // who was on each phase's roll
  const how = (p: Phase, x: Pupil) => !may.get(p.id)!.has(x.id) ? <span className="meta">Not eligible</span>
    : x.id in p.roll! ? <span className="no">Absent{p.excused?.includes(x.id) && ', made eligible'}</span> : <span className="ok">Present</span>;
  return (
    <Sheet sheet={sheet} title="Students" count={pool.length}>
      <div className="panel roster">
        <div className="panel-bar"><label className="search w240"><Icon n="search" s={14} /><input type="search" placeholder="Search by name or reg. no." value={q} onChange={e => setQ(e.target.value)} aria-label="Search students" /></label><span className="meta">{shown.length} shown</span></div>
        <div className="scroll"><table>
          <thead><tr><th>#</th><th>Reg. no.</th><th>Name</th><th>Campus</th>{took.map(p => <th key={p.id}>{shortOf(d, p)}</th>)}</tr></thead>
          <tbody>
            {shown.map(({ x, i }) => (
              <tr key={x.id}><td className="num">{i + 1}</td><td className="reg">{x.reg}</td><td><b>{x.name}</b></td><td><Camp c={x.campus} /></td>{took.map(p => <td key={p.id}>{how(p, x)}</td>)}</tr>
            ))}
            {!shown.length && <tr><td colSpan={4 + took.length} className="empty">No students</td></tr>}
          </tbody>
        </table></div>
      </div>
    </Sheet>
  );
}

// Who takes an OA or the interviews, chosen before its attendance: those present at the phase before it (everyone on the
// list for the first), or the company's shortlist. Uploading a shortlist (any column of registration numbers) first
// shows who on it takes part, who missed the PPT (they stay out) and numbers that aren't on the drive's list; it is
// saved only then. Fixed once the phase's attendance has begun.
function Source({ d, p, edit, send }: { d: Drive; p: Phase; edit: boolean; send: Send }) {
  const [box, openBox] = useSheet(), [got, setGot] = useState<{ file: string; regs: string[] } | null>(null), file = useRef<HTMLInputElement>(null);
  const locked = p.k === 'int' ? d.status !== 'planned' : !!p.roll, n = p.shortlist?.length, what = shortOf(d, p);
  const ph = phasesOf(d), before = ph[prevOf(d, ph.findIndex(x => x.id === p.id))], prev = before ? `From the ${shortOf(d, before)}` : 'Everyone on the list';
  const load = async (f?: File) => {
    if (!f) return;
    try {
      const regs = [...new Set((await readTable(f)).flat().map(regOf).filter(Boolean))];
      if (!regs.length) return toast('No registration numbers in that file', true);
      setGot({ file: f.name, regs }); openBox();
    } catch { toast("Couldn't read that file. Save it as .csv or .xlsx and try again", true) }
  };
  const usePrev = async () => {
    if (p.prev) return;
    if (n && !await ask(`Take ${fromPrev(d, p)} instead?`, `The shortlist of ${n} no longer decides who takes the ${what}.`, 'Use them instead')) return;
    send({ type: 'shortlist', k: p.id, regs: null });
  };
  // who a shortlist can include: everyone on the list who didn't miss the PPT
  const base = new Set(eligible({ ...d, phases: ph.map(x => x.id === p.id ? { ...x, shortlist: (d.pool ?? []).map(s => s.id) } : x) }, p.id).map(x => x.id));
  const pool = new Map((d.pool ?? []).map(x => [x.reg, x]));
  const ok = got?.regs.filter(r => pool.has(r) && base.has(pool.get(r)!.id)) ?? [];
  const out = got?.regs.filter(r => pool.has(r) && !base.has(pool.get(r)!.id)).map(r => pool.get(r)!) ?? [];
  const unknown = got?.regs.filter(r => !pool.has(r)) ?? [];
  return (
    <div className="slist">
      {edit && !locked ? <>
        <div className="seg src" role="radiogroup" aria-label={`Who takes the ${what}`}>
          <button role="radio" aria-checked={!!p.prev} className={p.prev ? 'on' : ''} onClick={usePrev} title={`Those present at the phase before it take the ${what}`}>{prev}</button>
          <button role="radio" aria-checked={!!n} className={n ? 'on' : ''} onClick={() => file.current?.click()} title={n ? 'Upload a new shortlist' : 'Upload the company\u2019s shortlist'}>{n ? `Shortlist · ${n}` : 'Shortlist'}</button>
        </div>
        <input ref={file} type="file" accept=".csv,.xlsx,.txt" hidden onChange={e => { load(e.target.files?.[0]); e.target.value = '' }} />
        {!chosen(p) && <small className="src-need">Choose before taking attendance</small>}
      </> : <span>{n ? <>Shortlist · <b>{n}</b> student{n === 1 ? '' : 's'}</> : p.prev ? prev : <span className="faint">Not chosen yet</span>}</span>}
      <dialog ref={box} className="ask slist-box" onClose={() => setGot(null)}>
        {got && <form method="dialog" onSubmit={() => send({ type: 'shortlist', k: p.id, regs: got.regs })}>
          <h3>Shortlist for the {what}</h3>
          <p>{got.regs.length} registration number{got.regs.length === 1 ? '' : 's'} in {got.file}.</p>
          <ul className="slist-sum">
            <li className="ok"><Icon n="check" s={15} /><span><b>{ok.length}</b> on the drive&rsquo;s list: they take the {what}</span></li>
            {out.length > 0 && <li className="warn"><Icon n="alert" s={15} /><span><b>{out.length}</b> missed the PPT, so they stay out
              <small>{out.map(x => x.name).join(', ')}</small></span></li>}
            {unknown.length > 0 && <li className="bad"><Icon n="x" s={15} /><span><b>{unknown.length}</b> not on the drive&rsquo;s student list, left out
              <small className="reg">{unknown.join(', ')}</small></span></li>}
          </ul>
          <div className="row"><div className="sp" /><button type="button" onClick={() => box.current?.close()}>Cancel</button>
            <button className="primary" disabled={!ok.length && !out.length}>Save shortlist</button></div>
        </form>}
      </dialog>
    </div>
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
function Interviews({ d, p, s, open, send, edit, wait }: { d: Drive; p: Phase; s: PhaseState; open: () => void; send: Send; edit: boolean; wait: boolean }) {
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
        <AttendanceTable all={d.students} absent={gone} why={x => (x as Drive['students'][number]).reason ?? ''} edit={edit ? (x, reason) => send({ type: 'reason', id: x.id, reason }) : undefined} />
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
      {!edit ? <div className="ivset">
        <div><span><b>Rounds</b><small>{d.rounds.join(' · ')}</small></span></div>
        <div><span><b>Cabins</b><small>{!ready ? 'None yet' : running ? `${free} free right now` : `${d.rooms.length} cabins`}</small></span></div>
      </div> : <div className="ivset">
        <div><span><b>Rounds</b><small>{d.rounds.join(' · ')}</small></span>
          <Stepper label="Rounds" value={d.rounds.length} min={1} max={10} less={() => send({ type: 'delRound' })} more={() => send({ type: 'addRound' })} />
          <button className="sm" onClick={() => show('Rounds')} title="Name the rounds">Edit</button></div>
        <div><span><b>Cabins</b><small>{!ready ? 'None yet' : running ? `${free} free right now` : `${named} of ${d.rooms.length} with an interviewer`}</small></span>
          <Stepper label="Cabins" value={d.rooms.length} min={0} max={60} less={() => send({ type: 'delRoom', room: d.rooms[d.rooms.length - 1].id })} more={() => send({ type: 'addRoom' })} />
          <button className="sm" disabled={!ready} onClick={() => show('Cabins')} title="Name the interviewers and pick their rounds">Edit</button></div>
      </div>}
      {!edit && <p className="meta">Only the interviews&rsquo; volunteers run them. Volunteer above to help.</p>}
      {edit && !d.attendance && <p className="meta">{opened ? `${d.students.length - off} present · ${off} absent so far. ` : d.pool ? `${eligible(d, p.id).length} eligible students. ` : ''}{wait && planned ? 'Attendance opens once the earlier phases end.'
        : opened ? 'Confirm the attendance to open the board.' : 'Take attendance whenever the students are in.'}</p>}
      {edit && <div className="ph-acts">
        {!d.attendance
          ? <>
            <button disabled title="Confirm the attendance first">Open board<Icon n="right" /></button>
            <button className="primary" disabled={planned && (wait || !chosen(p))} title={planned && !chosen(p) ? 'Choose who takes part first, under Students above' : planned && wait ? 'The earlier phases decide who takes part: end them first' : undefined} onClick={go}><Icon n="roll" />{opened ? 'Continue attendance' : 'Take attendance'}</button>
          </>
          : <>
            <button className="danger soft" disabled={!called(d)} title={!called(d) ? 'The interviews start with the first student called' : undefined} onClick={end}><Icon n="flag" />End interviews</button>
            <button className="primary" onClick={go}>Open board<Icon n="right" /></button>
          </>}
      </div>}
      <Sheet sheet={box} className="small" title={what} count={what === 'Rounds' ? d.rounds.length : d.rooms.length}>
        <div className="sheet-b">
          {what === 'Rounds' ? <RoundsEdit d={d} send={send} /> : <CabinsEdit d={d} send={send} />}
        </div>
        <div className="wfoot"><div className="sp" /><button className="primary" onClick={() => box.current?.close()}>Done</button></div>
      </Sheet>
    </div>
  );
}
