'use client';
import { useEffect, useState } from 'react';
import { LOCATIONS, RES, doneLabel, parseStudents, rname, statusLabel, toTable, type Campus, type Drive, type Placed, type Row, type Status } from '@/lib/drive';
import { Camp } from './board';
import { AlsoIn, Field, Icon, More, download, longDate, tm, toast, useNow, withPin, type Seen, type Send } from './ui';

const RES_ICON = { done: '', reject: '✗', 'no-show': 'no-show', moved: 'moved' };
// the places drives are held, as buttons side by side
export const LocationPick = ({ value, onPick }: { value: string; onPick: (l: string) => void }) => (
  <div className="locs" role="radiogroup" aria-label="Location">
    {LOCATIONS.map(l => <button key={l} type="button" role="radio" aria-checked={value === l} className={value === l ? 'on' : ''} onClick={() => onPick(l)}>{l}</button>)}
  </div>
);

// The students with one status (opened from the numbers in a drive's header). Read-only, except on the Absent list:
// the reason can be written there, and ⋯ › Mark as present puts a late arrival back in their round's queue.
export function Students({ d, status, send, also }: { d: Drive; status: Status | 'present'; send: Send; also?: Seen }) {
  const [q, setQ] = useState('');
  const [c, setC] = useState<'all' | Campus>('all');
  const journey = status === 'present' || status === 'in' || status === 'pending'; // not shown for absent, selected or rejected
  const rows = d.students.map((s, i) => ({ s, i })).filter(({ s }) =>
    (status === 'present' ? s.status !== 'absent' : s.status === status) && (!q || `${s.reg} ${s.name}`.toLowerCase().includes(q.toLowerCase())) && (c === 'all' || s.campus === c));
  return (
    <div className="panel">
      <div className="panel-bar">
        <label className="search w240"><Icon n="search" s={14} /><input type="search" placeholder="Search by name or reg. no." value={q} onChange={e => setQ(e.target.value)} aria-label="Search students" /></label>
        <select value={c} onChange={e => setC(e.target.value as Campus)} aria-label="Filter by campus">
          <option value="all">All campuses</option>
          <option value="BLR">BLR</option><option value="MPL">MPL</option>
        </select>
        <span className="meta">{rows.length} shown</span>
      </div>
      <div className="scroll">
        <table>
          <thead><tr><th>#</th><th>Reg. no.</th><th>Name</th><th>Campus</th><th>Rounds finished</th>{status === 'absent' && <th>Reason</th>}{journey && <th>Journey (in–out)</th>}</tr></thead>
          <tbody>
            {rows.map(({ s, i }) => (
              <tr key={s.id}>
                <td className="num">{i + 1}</td>
                <td className="reg">{s.reg}</td>
                <td className="name">{s.name} <AlsoIn a={also?.[s.id]} /></td>
                <td><Camp c={s.campus} /></td>
                <td>{doneLabel(d, s.done)}</td>
                {status === 'absent' && <td><div className="why">
                  <Field value={s.reason ?? ''} placeholder="Add a reason" maxLength={200} aria-label={`Why ${s.name} is absent`} onSave={reason => send({ type: 'reason', id: s.id, reason })} />
                  <More className="icon sm ghost" label={`More for ${s.name}`} items={[[<><Icon n="check" />Mark as present</>, () => send({ type: 'move', id: s.id, to: 'waiting' })]]} />
                </div></td>}
                {journey && <td>{s.hist.map((h, j) => <span key={j} className="j">{rname(d, h.r)} · {h.room} {tm(h.in || h.call)}{h.out ? '–' + tm(h.out) : ''} {h.res ? RES_ICON[h.res] : ''}</span>)}</td>}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="empty">No students</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function exportCSV(d: Drive) {
  const head = ['Registration number', 'Name', 'Campus', 'Status', 'Rounds finished', ...d.rounds.flatMap(n => [`${n} cabin`, `${n} in`, `${n} out`, `${n} result`])];
  const rows = d.students.map(s => [s.reg, s.name, s.campus, statusLabel(d, s), s.done, ...d.rounds.flatMap((_, i) => {
    const h = [...s.hist].reverse().find(h => h.r === i && h.in);
    return h ? [h.room, tm(h.in), tm(h.out), h.res ? RES[h.res] : ''] : ['', '', '', ''];
  })]);
  const csv = [head, ...rows].map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  download(`${d.company}-${d.date}-results.csv`, '﻿' + csv, 'text/csv'); // BOM so Excel reads Indian names correctly
}

// Upload (CSV / Excel) or paste a student list, then review names and campuses before they are added.
export function StudentImport({ rows, setRows, fallback, setFallback }: { rows: Row[]; setRows: (r: Row[]) => void; fallback: Campus; setFallback: (c: Campus) => void }) {
  const [over, setOver] = useState(false);
  const [paste, setPaste] = useState<string | null>(null);
  const [file, setFile] = useState('');
  // students already selected in an earlier drive are left out; the desk can keep them (a dream-company rule, say)
  const [placed, setPlaced] = useState<Placed>({});
  const [left, setLeft] = useState<Row[]>([]);
  useEffect(() => { fetch(withPin('/api/drives')).then(r => r.ok ? r.json() : null).then(j => j && setPlaced(j.placed ?? {})).catch(() => {}) }, []);
  const take = (got: Row[], name = '') => {
    if (!got.length) return toast('No names found', true);
    setRows(got.filter(r => !placed[r.reg]));
    setLeft(got.filter(r => placed[r.reg]));
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

  if (!rows.length && !left.length) return (
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
        <button className="sm ghost" onClick={() => { setRows([]); setLeft([]); setFile(''); setPaste(null) }}>Use a different list</button>
      </div>
      {left.length > 0 && (
        <div className="placed" role="alert">
          <Icon n="alert" s={16} />
          <div className="grow">
            <b>{left.length} already placed, left out of this drive</b>
            <ul>{left.map(r => <li key={r.reg}>{r.name} <span className="reg">{r.reg}</span> · placed at {placed[r.reg].company} on {longDate(placed[r.reg].date)}</li>)}</ul>
          </div>
          <button className="sm" onClick={() => { setRows([...rows, ...left]); setLeft([]) }}>Keep them anyway</button>
        </div>
      )}
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

export function Setup({ d, send }: { d: Drive; send: Send }) {
  const t = useNow();
  const toggle = (r: Drive['rooms'][number], i: number) => {
    const has = r.rounds.includes(i);
    if (has && r.rounds.length === 1) return toast(`${r.name} needs at least one round`, true);
    send({ type: 'roomRounds', room: r.id, rounds: has ? r.rounds.filter(x => x !== i) : [...r.rounds, i] });
  };
  return (
    <div className="setup">
      <div className="colm">
        <section className="card">
          <div className="card-h"><h2>Drive</h2><p className="meta">How it appears on the dashboard and in the calendar.</p></div>
          <label className="field">Company<Field value={d.company} onSave={name => send({ type: 'company', name })} /></label>
          <label className="field">Date<input type="date" value={d.date} onChange={e => e.target.value && send({ type: 'date', date: e.target.value })} /></label>
          <div className="field">Location<LocationPick value={d.location} onPick={location => send({ type: 'location', location })} /></div>
          <div className="field">Rounds, in order</div>
          {d.rounds.map((n, i) => <div key={i} className="line"><span className="num">{i + 1}</span><Field value={n} aria-label={`Round ${i + 1} name`} onSave={name => send({ type: 'renameRound', i, name })} /></div>)}
          <div className="row"><button className="sm" onClick={() => send({ type: 'addRound' })}><Icon n="plus" s={14} />Add round</button>{d.rounds.length > 1 && <button className="sm ghost" onClick={() => send({ type: 'delRound' })}>Remove last</button>}</div>
        </section>
        <section className="card">
          <div className="card-h"><h2>Results</h2><p className="meta">Saved automatically on this laptop (<code>data/drives/{d.id}.json</code>).</p></div>
          <div className="row"><button onClick={() => exportCSV(d)}><Icon n="download" />Download results till {tm(t)}</button></div>
        </section>
      </div>

      <div className="colm">
        <section className="card">
          <div className="card-h row">
            <div><h2>Cabins <span className="cnt">{d.rooms.length}</span></h2><p className="meta">Tick the rounds each cabin conducts. When you call a student, cabins for their round are suggested first.</p></div>
            <button onClick={() => send({ type: 'addRoom' })}><Icon n="plus" />Add cabin</button>
          </div>
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
              </tbody>
            </table>
          </div>
        </section>
      </div>

    </div>
  );
}

const mins = (ms: number) => ms ? `${Math.max(1, Math.round(ms / 60000))} min` : '—';
const avg = (ms: number[]) => ms.length ? ms.reduce((a, b) => a + b) / ms.length : 0;

// An ended drive at a glance: how each campus did, each round, and each cabin.
export function Summary({ d }: { d: Drive }) {
  type S = Drive['students'][number];
  const count = (f: (s: S) => boolean) => d.students.filter(f).length;
  const campus = (c: Campus | null) => [(s: S) => !!s, (s: S) => s.status !== 'absent', (s: S) => s.status === 'selected', (s: S) => s.status === 'rejected']
    .map(f => count(s => (c === null || s.campus === c) && f(s))); // null: everyone
  const held = d.students.flatMap(s => s.hist).filter(h => h.res === 'done'); // interviews that finished normally
  const time = (f: (h: (typeof held)[number]) => boolean) => mins(avg(held.filter(h => f(h) && h.in && h.out).map(h => h.out! - h.in!)));
  return (
    <div className="summary">
      <section className="card">
        <div className="card-h"><h2>By campus</h2><p className="meta">Students on the list, and how they did</p></div>
        <table>
          <thead><tr><th>Campus</th><th>Students</th><th>Present</th><th>Selected</th><th>Rejected</th></tr></thead>
          <tbody>
            {(['MPL', 'BLR', ''] as Campus[]).filter(c => c || count(s => !s.campus)).map(c => ( // drives from before campuses were required can have some without one
              <tr key={c}><td>{c ? <Camp c={c} /> : <span className="meta">No campus</span>}</td>{campus(c).map((v, i) => <td key={i} className={i === 2 && v ? 'ok' : ''}>{v}</td>)}</tr>
            ))}
            <tr className="total"><td>Total</td>{campus(null).map((v, i) => <td key={i}>{v}</td>)}</tr>
          </tbody>
        </table>
      </section>
      <section className="card">
        <div className="card-h"><h2>Round by round</h2><p className="meta">Interviews held, and who cleared each round</p></div>
        <table>
          <thead><tr><th>Round</th><th>Interviewed</th><th>Cleared</th><th>Rejected</th><th>Avg. time</th></tr></thead>
          <tbody>{d.rounds.map((name, i) => (
            <tr key={i}>
              <td className="name">{name}</td>
              <td>{count(s => s.hist.some(h => h.r === i && h.res === 'done'))}</td>
              <td>{count(s => s.done > i + 1 || (s.done === i + 1 && ['waiting', 'in', 'selected'].includes(s.status)))}</td>
              <td>{count(s => s.status === 'rejected' && s.done === i + 1)}</td>
              <td>{time(h => h.r === i)}</td>
            </tr>
          ))}</tbody>
        </table>
      </section>
      <section className="card">
        <div className="card-h"><h2>Cabins</h2><p className="meta">Interviews each panel took</p></div>
        <table>
          <thead><tr><th>Cabin</th><th>Interviews</th><th>Avg. time</th></tr></thead>
          <tbody>{d.rooms.map(r => (
            <tr key={r.id}>
              <td><span className="name">{r.name}</span>{r.panel && <span className="meta"> · {r.panel}</span>}</td>
              <td>{held.filter(h => h.room === r.name).length}</td>
              <td>{time(h => h.room === r.name)}</td>
            </tr>
          ))}</tbody>
        </table>
      </section>
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
