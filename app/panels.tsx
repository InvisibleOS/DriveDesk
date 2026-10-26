'use client';
import { useId, useState } from 'react';
import { SHORT, absentAt, missed, venuesOf, doneLabel, eligible, parseStudents, rname, statusLabel, toTable, type Campus, type Drive, type Phase, type Row, type Status } from '@/lib/drive';
import { Camp } from './board';
import { AlsoIn, Field, Icon, More, Stat, download, tm, toast, type Seen, type Send } from './ui';

const RES_ICON = { done: '', reject: '✗', 'no-show': 'no-show', moved: 'moved' };
// a place: anything typed (saved when the field is left), or one of the usual ones from the dropdown (saved at once)
export const Venue = ({ value, onSave, options }: { value: string; onSave: (v: string) => void; options: string[] }) => {
  const id = useId();
  return <>
    <Field value={value} list={id} placeholder="Type a place, or pick one" maxLength={80} onSave={onSave}
      onChange={e => { if (options.includes(e.target.value) && e.target.value !== value) onSave(e.target.value) }} />
    <datalist id={id}>{options.map(o => <option key={o} value={o} />)}</datalist>
  </>;
};

// The students with one status (opened from the numbers in a drive's header). Read-only, except on the Absent list:
// the reason can be written there, and ⋯ › Mark as present puts a late arrival back in their round's queue.
export function Students({ d, status, send, also }: { d: Drive; status: Status | 'present'; send: Send; also?: Seen }) {
  const [q, setQ] = useState('');
  const [c, setC] = useState<'all' | Campus>('all');
  const journey = status === 'present' || status === 'in' || status === 'pending'; // not shown for absent, selected or rejected
  const rows = d.students.map((s, i) => ({ s, i })).filter(({ s }) =>
    (status === 'present' ? s.status !== 'absent' : s.status === status) && (!q || `${s.reg} ${s.name}`.toLowerCase().includes(q.toLowerCase())) && (c === 'all' || s.campus === c));
  const away = status === 'absent' ? missed(d).filter(({ s }) => (!q || `${s.reg} ${s.name}`.toLowerCase().includes(q.toLowerCase())) && (c === 'all' || s.campus === c)) : [];
  return (
    <div className="panel">
      <div className="panel-bar">
        <label className="search w240"><Icon n="search" s={14} /><input type="search" placeholder="Search by name or reg. no." value={q} onChange={e => setQ(e.target.value)} aria-label="Search students" /></label>
        <select value={c} onChange={e => setC(e.target.value as Campus)} aria-label="Filter by campus">
          <option value="all">All campuses</option>
          <option value="BLR">BLR</option><option value="MPL">MPL</option>
        </select>
        <span className="meta">{rows.length + away.length} shown</span>
      </div>
      <div className="scroll">
        <table>
          <thead><tr><th>#</th><th>Reg. no.</th><th>Name</th><th>Campus</th>{status === 'absent' ? <><th>Absent at</th><th>Reason</th></> : <th>Rounds finished</th>}{journey && <th>Journey (in–out)</th>}</tr></thead>
          <tbody>
            {rows.map(({ s, i }) => (
              <tr key={s.id}>
                <td className="num">{i + 1}</td>
                <td className="reg">{s.reg}</td>
                <td className="name">{s.name} <AlsoIn a={also?.[s.id]} /></td>
                <td><Camp c={s.campus} /></td>
                {status === 'absent' ? <td>{absentAt(d, s)}</td> : <td>{doneLabel(d, s.done)}</td>}
                {status === 'absent' && <td><div className="why">
                  <Field value={s.reason ?? ''} placeholder="Add a reason" maxLength={200} aria-label={`Why ${s.name} is absent`} onSave={reason => send({ type: 'reason', id: s.id, reason })} />
                  <More className="icon sm ghost" label={`More for ${s.name}`} items={[[<><Icon n="check" />Mark as present</>, () => send({ type: 'move', id: s.id, to: 'waiting' })]]} />
                </div></td>}
                {journey && <td>{s.hist.map((h, j) => <span key={j} className="j">{rname(d, h.r)} · {h.room} {tm(h.in || h.call)}{h.out ? '–' + tm(h.out) : ''} {h.res ? RES_ICON[h.res] : ''}</span>)}</td>}
              </tr>
            ))}
            {/* missed a PPT or OA, so never on the interviews' list: making them eligible adds them there */}
            {away.map(({ s, k, reason }, i) => (
              <tr key={s.id}>
                <td className="num">{d.students.length + i + 1}</td>
                <td className="reg">{s.reg}</td>
                <td className="name">{s.name}</td>
                <td><Camp c={s.campus} /></td>
                <td>{SHORT[k]}</td>
                <td><div className="why"><Field value={reason} placeholder="Add a reason" maxLength={200} aria-label={`Why ${s.name} missed the ${SHORT[k]}`} onSave={reason => send({ type: 'reason', k, id: s.id, reason })} />
                  <More className="icon sm ghost" label={`More for ${s.name}`} items={[[<><Icon n="check" />Make eligible</>, () => send({ type: 'excuse', k, id: s.id })]]} />
                </div></td>
              </tr>
            ))}
            {!rows.length && !away.length && <tr><td colSpan={7} className="empty">No students</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// a sheet Excel opens as it is: quoted cells, and a BOM so Indian names read correctly
const saveCSV = (name: string, rows: unknown[][]) => download(name, '\ufeff' + rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');

// A talk's or test's attendance sheet: everyone eligible for it, present or absent, and who was let through anyway.
export function exportAttendance(d: Drive, p: Phase) {
  const roll = p.roll ?? {};
  saveCSV(`${d.company}-${SHORT[p.k]}-attendance.csv`, [['Registration number', 'Name', 'Campus', 'Attendance', 'Reason for absence', 'Made eligible'],
    ...eligible(d, p.k).map(s => [s.reg, s.name, s.campus, s.id in roll ? 'Absent' : 'Present', roll[s.id] ?? '', p.excused?.includes(s.id) ? 'Yes' : ''])]);
}

// Upload (CSV / Excel) or paste a student list, then review names and campuses before they are added.
export function StudentImport({ rows, setRows, fallback, setFallback }: { rows: Row[]; setRows: (r: Row[]) => void; fallback: Campus; setFallback: (c: Campus) => void }) {
  const [over, setOver] = useState(false);
  const [paste, setPaste] = useState<string | null>(null);
  const [file, setFile] = useState('');
  const take = (got: Row[], name = '') => {
    if (!got.length) return toast('No names found', true);
    setRows(got);
    setFile(name);
  };
  const load = async (f?: File) => {
    if (!f) return;
    try {
      const table = /\.xlsx$/i.test(f.name)
        ? (await (await import('read-excel-file/browser')).readSheet(f)).map(r => r.map(c => String(c ?? '')))
        : toTable(await f.text());
      take(parseStudents(table), f.name);
    } catch { toast("Couldn't read that file. Save it as .csv or .xlsx and try again", true) }
  };

  if (!rows.length) return (
    <div className="importer">
      {paste === null ? <>
        <label className={`drop${over ? ' over' : ''}`} onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); load(e.dataTransfer.files[0]) }}>
          <span className="drop-ico"><Icon n="upload" s={20} /></span>
          <b>Drop the student list here, or <u>choose a file</u></b>
          <span className="meta">CSV or Excel. Only the registration number, name and campus (BLR / MPL) columns are used.</span>
          <input type="file" accept=".csv,.xlsx,.txt" hidden onChange={e => { load(e.target.files?.[0]); e.target.value = '' }} />
        </label>
        <button className="link" onClick={() => setPaste('')}>or paste names instead</button>
      </> : <>
        <textarea className="grow" autoFocus value={paste} onChange={e => setPaste(e.target.value)} placeholder={'Registration number, Name, Campus\n230905001, Aarav Shah, BLR\n230905002, Diya Patel, MPL'} aria-label="Paste names" />
        <div className="row">
          <button className="primary" disabled={!paste.trim()} onClick={() => take(parseStudents(toTable(paste)))}>Use these names</button>
          <button className="ghost" onClick={() => setPaste(null)}>Back to upload</button>
        </div>
      </>}
    </div>
  );

  const unknown = rows.filter(r => !r.campus).length, noReg = rows.filter(r => !r.reg).length, n = (k: Campus) => rows.filter(r => (r.campus || fallback) === k).length;
  return (
    <div className="importer">
      <div className="counts">
        <b>{rows.length} students</b>{file && <span className="meta">from {file}</span>}
        <span className="camp c-BLR">BLR {n('BLR')}</span><span className="camp c-MPL">MPL {n('MPL')}</span>
        {noReg > 0 && <span className="meta warn">{noReg} without a registration number</span>}
        <div className="sp" />
        <button className="sm ghost" onClick={() => { setRows([]); setFile(''); setPaste(null) }}>Use a different list</button>
      </div>
      {unknown > 0 && (
        <div className="fallback">
          <span>{unknown} student{unknown > 1 ? 's have' : ' has'} no campus in the list. Every student needs one: mark them as</span>
          <div className="seg">{(['BLR', 'MPL'] as Campus[]).map(k => <button key={k} className={fallback === k ? 'on' : ''} onClick={() => setFallback(k)}>{k}</button>)}</div>
        </div>
      )}
      <div className="scroll plist">
        {rows.map((r, i) => (
          <div key={i} className="prow">
            <span className="num">{i + 1}</span><span className="reg">{r.reg || '—'}</span><span className="nm">{r.name}</span>
            {r.campus || fallback ? <Camp c={r.campus || fallback} /> : <span className="meta warn">No campus</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// The interviews' rounds, in order, by name. Changes save as they are made.
export const RoundsEdit = ({ d, send }: { d: Drive; send: Send }) => <>
  <div className="stephead"><span>Students go through them in this order. Rename them if you like, e.g. Technical, HR. Changes save as you make them.</span>
    <button className="sm" disabled={d.rounds.length >= 10} onClick={() => send({ type: 'addRound' })}><Icon n="plus" s={14} />Add round</button></div>
  <div className="scroll matrix">
    <table>
      <thead><tr><th className="cb n">Round</th><th>Name</th></tr></thead>
      <tbody>{d.rounds.map((n, i) => (
        <tr key={`${i}-${n}`}>
          <td className="cb n"><span className="sn">{i + 1}</span>{d.rounds.length > 1 && <button className="icon sm ghost rmx" onClick={() => send({ type: 'delRound', i })} title="Remove round" aria-label={`Remove ${n}`}><Icon n="x" s={12} /></button>}</td>
          <td><Field value={n} placeholder="Round name, e.g. Technical" maxLength={40} aria-label={`Round ${i + 1} name`} onSave={name => send({ type: 'renameRound', i, name })} /></td>
        </tr>
      ))}</tbody>
    </table>
  </div>
</>;

// The interviews' cabins: each one's interviewer and the rounds it takes. Changes save as they are made.
export function CabinsEdit({ d, send }: { d: Drive; send: Send }) {
  const toggle = (r: Drive['rooms'][number], i: number) => {
    const has = r.rounds.includes(i);
    if (has && r.rounds.length === 1) return toast(`${r.name} needs at least one round`, true);
    send({ type: 'roomRounds', room: r.id, rounds: has ? r.rounds.filter(x => x !== i) : [...r.rounds, i] });
  };
  return <>
    <div className="stephead"><span>Each cabin&rsquo;s interviewer, and the rounds it takes. When you call a student, cabins for their round are suggested first. Changes save as you make them.</span>
      <button className="sm" disabled={d.rooms.length >= 60} onClick={() => send({ type: 'addRoom' })}><Icon n="plus" s={14} />Add cabin</button></div>
    <div className="scroll matrix">
      <table>
        <thead><tr><th className="cb n">Cabin</th><th>Interviewer</th>{d.rounds.map((n, i) => <th key={i} className="cb" title={n}>R{i + 1}</th>)}</tr></thead>
        <tbody>
          {d.rooms.map((r, ri) => (
            <tr key={r.id}>
              <td className="cb n"><span className="sn">{ri + 1}</span><button className="icon sm ghost rmx" onClick={() => send({ type: 'delRoom', room: r.id })} title="Remove cabin" aria-label={`Remove ${r.name}`}><Icon n="x" s={12} /></button></td>
              <td><Field value={r.panel} maxLength={60} placeholder="Interviewer name" aria-label={`${r.name} interviewer`} onSave={panel => send({ type: 'editRoom', room: r.id, panel })} /></td>
              {d.rounds.map((n, i) => <td key={i} className="cb"><input type="checkbox" checked={r.rounds.includes(i)} onChange={() => toggle(r, i)} aria-label={`${r.name} takes ${n}`} /></td>)}
            </tr>
          ))}
          {!d.rooms.length && <tr><td colSpan={2 + d.rounds.length} className="empty">No cabins yet</td></tr>}
        </tbody>
      </table>
    </div>
  </>;
}

export function Setup({ d, send }: { d: Drive; send: Send }) {
  return (
    <div className="setup">
      <div className="colm">
        <section className="card">
          <div className="card-h"><h2>Drive</h2><p className="meta">How it appears on the dashboard and in the calendar.</p></div>
          <label className="field">Date<input type="date" value={d.date} onChange={e => e.target.value && send({ type: 'date', date: e.target.value })} /></label>
          <label className="field">Location<Venue value={d.location} options={venuesOf('int')} onSave={location => send({ type: 'location', location })} /></label>
          <div className="field">Rounds, in order</div>
          <RoundsEdit d={d} send={send} />
        </section>
      </div>

      <div className="colm">
        <section className="card">
          <div className="card-h"><h2>Cabins <span className="cnt">{d.rooms.length}</span></h2></div>
          <CabinsEdit d={d} send={send} />
        </section>
      </div>

    </div>
  );
}

const mins = (ms: number) => ms ? `${Math.max(1, Math.round(ms / 60000))} min` : '—';
const avg = (ms: number[]) => ms.length ? ms.reduce((a, b) => a + b) / ms.length : 0;

const hm = (ms: number) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.max(1, m)} min` };
const pct = (a: number, b: number) => b ? `${Math.round(a * 100 / b)}%` : '—';
const CAMPUS_ORDER: Campus[] = ['BLR', 'MPL', '']; // Bangalore first: it is the committee's own campus

// The report of an ended drive: headline numbers, who was selected, how Bangalore did, then campus, round and cabin detail.
export function Summary({ d }: { d: Drive }) {
  type S = Drive['students'][number];
  const count = (f: (s: S) => boolean) => d.students.filter(f).length;
  const byCampus = (a: S, b: S) => CAMPUS_ORDER.indexOf(a.campus) - CAMPUS_ORDER.indexOf(b.campus) || a.name.localeCompare(b.name);
  const present = d.students.filter(s => s.status !== 'absent');
  const held = d.students.flatMap(s => s.hist).filter(h => h.res === 'done'); // interviews that finished normally
  const timed = held.filter(h => h.in && h.out);
  const time = (f: (h: (typeof held)[number]) => boolean) => mins(avg(timed.filter(f).map(h => h.out! - h.in!)));
  const picked = d.students.filter(s => s.status === 'selected').sort(byCampus);
  const blr = d.students.filter(s => s.campus === 'BLR');
  const blrIn = blr.filter(s => s.status !== 'absent');
  const blrPicked = picked.filter(s => s.campus === 'BLR').length;
  const last = (s: S) => [...s.hist].reverse().find(h => h.res === 'done'); // the final interview, the one that ended in an offer
  const panel = (room?: string) => d.rooms.find(r => r.name === room)?.panel;
  const start = d.attendance && d.attendance < d.startedAt ? d.attendance : d.startedAt; // waits count from attendance (earlier drives started with it)
  const waits = present.map(s => s.hist[0]?.call).filter((t): t is number => !!t && t > start).map(t => t - start);
  const open = d.students.filter(s => ['waiting', 'in', 'pending'].includes(s.status)).sort(byCampus); // still in the process when the drive ended
  const cleared = (s: S) => Math.max(0, s.status === 'rejected' || s.status === 'pending' ? s.done - 1 : s.done); // the last round's result counts only once it is known and positive
  const blrOthers = blr.filter(s => s.status !== 'selected' && s.status !== 'absent').sort((a, b) => cleared(b) - cleared(a) || a.name.localeCompare(b.name));
  const campusRow = (c: Campus | null) => {
    const in_ = (s: S) => c === null || s.campus === c;
    const all = count(in_), here = count(s => in_(s) && s.status !== 'absent'), sel = count(s => in_(s) && s.status === 'selected');
    return [all, here, sel, count(s => in_(s) && s.status === 'rejected'), pct(sel, here)];
  };
  const Who = ({ s }: { s: S }) => <><span className="name">{s.name}</span>{s.reg && <span className="reg"> {s.reg}</span>}</>;
  return (
    <div className="summary">
      <div className="stats wide">
        <Stat label="Duration" value={d.endedAt ? hm(d.endedAt - d.startedAt) : '—'} sub={<>{tm(d.startedAt)}{d.endedAt && ` – ${tm(d.endedAt)}`}</>} />
        <Stat label="Turnout" value={pct(present.length, d.students.length)} sub={`${present.length} of ${d.students.length}`} />
        <Stat label="Selection rate" value={pct(picked.length, present.length)} tone="ok" sub={`${picked.length} of ${present.length} present`} />
        <Stat label="BLR selected" value={blrPicked} tone="ok" sub={`${pct(blrPicked, blrIn.length)} of ${blrIn.length} present`} />
        <Stat label="Interviews" value={held.length} sub={`${time(() => true)} on average`} />
        <Stat label="Wait for first call" value={waits.length ? mins(avg(waits)) : '—'} sub="on average" />
      </div>

      <section className="card wide">
        <div className="card-h row"><div><h2>Selected <span className="cnt">{picked.length}</span></h2><p className="meta">Bangalore first</p></div></div>
        {picked.length ? (
          <table>
            <thead><tr><th>Name</th><th>Registration no.</th><th>Campus</th><th>Final round</th><th>Selected at</th></tr></thead>
            <tbody>{picked.map(s => { const h = last(s); return (
              <tr key={s.id}>
                <td className="name">{s.name}</td>
                <td className="reg">{s.reg || '—'}</td>
                <td>{s.campus ? <Camp c={s.campus} /> : '—'}</td>
                <td>{h ? <>{rname(d, h.r)}<span className="meta"> · {h.room}{panel(h.room) && `, ${panel(h.room)}`}</span></> : '—'}</td>
                <td>{h?.out ? tm(h.out) : '—'}</td>
              </tr>
            ) })}</tbody>
          </table>
        ) : <p className="meta">Nobody was selected in this drive.</p>}
      </section>

      {blrOthers.length > 0 && (
        <section className="card wide">
          <div className="card-h"><h2>Bangalore, not selected <span className="cnt">{blrOthers.length}</span></h2><p className="meta">How far each one got, furthest first</p></div>
          <table>
            <thead><tr><th>Name</th><th>Registration no.</th><th>Rounds cleared</th><th>Outcome</th></tr></thead>
            <tbody>{blrOthers.map(s => (
              <tr key={s.id}>
                <td className="name">{s.name}</td>
                <td className="reg">{s.reg || '—'}</td>
                <td>{cleared(s)} of {d.rounds.length}</td>
                <td className={s.status === 'rejected' ? 'no' : ''}>{statusLabel(d, s)}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}

      <section className="card">
        <div className="card-h"><h2>By campus</h2><p className="meta">Students on the list, and how they did</p></div>
        <table>
          <thead><tr><th>Campus</th><th>Students</th><th>Present</th><th>Selected</th><th>Rejected</th><th>Rate</th></tr></thead>
          <tbody>
            {CAMPUS_ORDER.filter(c => c || count(s => !s.campus)).map(c => ( // drives from before campuses were required can have some without one
              <tr key={c}><td>{c ? <Camp c={c} /> : <span className="meta">No campus</span>}</td>{campusRow(c).map((v, i) => <td key={i} className={i === 2 && v ? 'ok' : ''}>{v}</td>)}</tr>
            ))}
            <tr className="total"><td>Total</td>{campusRow(null).map((v, i) => <td key={i}>{v}</td>)}</tr>
          </tbody>
        </table>
      </section>
      <section className="card">
        <div className="card-h"><h2>Round by round</h2><p className="meta">Interviews held, and who cleared each round</p></div>
        <table>
          <thead><tr><th>Round</th><th>Interviewed</th><th>Cleared</th><th>Rejected</th><th>Pass</th><th>Avg. time</th></tr></thead>
          <tbody>{d.rounds.map((name, i) => {
            const seen = count(s => s.hist.some(h => h.r === i && h.res === 'done'));
            const cleared = count(s => s.done > i + 1 || (s.done === i + 1 && ['waiting', 'in', 'selected'].includes(s.status)));
            return (
              <tr key={i}>
                <td className="name">{name}</td>
                <td>{seen}</td>
                <td>{cleared}</td>
                <td>{count(s => s.status === 'rejected' && s.done === i + 1)}</td>
                <td>{pct(cleared, seen)}</td>
                <td>{time(h => h.r === i)}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </section>
      <section className="card">
        <div className="card-h"><h2>Cabins</h2><p className="meta">Interviews each panel took, and time spent interviewing</p></div>
        <table>
          <thead><tr><th>Cabin</th><th>Interviews</th><th>Avg. time</th><th>Busy for</th></tr></thead>
          <tbody>{d.rooms.map(r => {
            const busy = timed.filter(h => h.room === r.name).reduce((a, h) => a + h.out! - h.in!, 0);
            return (
              <tr key={r.id}>
                <td><span className="name">{r.name}</span>{r.panel && <span className="meta"> · {r.panel}</span>}</td>
                <td>{held.filter(h => h.room === r.name).length}</td>
                <td>{time(h => h.room === r.name)}</td>
                <td>{busy ? hm(busy) : '—'}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </section>
      {open.length > 0 && (
        <section className="card">
          <div className="card-h"><h2>Unfinished <span className="cnt">{open.length}</span></h2><p className="meta">Still in the process when the drive ended</p></div>
          <table>
            <thead><tr><th>Name</th><th>Campus</th><th>Where they were</th></tr></thead>
            <tbody>{open.map(s => <tr key={s.id}><td><Who s={s} /></td><td>{s.campus ? <Camp c={s.campus} /> : '—'}</td><td className="meta">{statusLabel(d, s)}</td></tr>)}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}

export function Activity({ d }: { d: Drive }) {
  return (
    <div className="panel">
      <div className="panel-bar"><h2>Logs</h2><span className="cnt">{d.log.length}</span><span className="meta">newest first</span></div>
      <div className="scroll log">
        {d.log.slice(-500).reverse().map((l, i) => <div key={i}><time>{tm(l.t)}</time><span>{l.msg}</span></div>)}
        {!d.log.length && <p className="empty">Nothing yet.</p>}
      </div>
    </div>
  );
}
