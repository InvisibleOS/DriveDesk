'use client';
import { useEffect, useState } from 'react';
import { fits, occ, rname, roundOpen, upNext, roundsLabel, type Drive, type Room, type Student } from '@/lib/drive';
import { AlsoIn, Icon, tm, useFit, useNow, type Seen, type Send } from './ui';

const mins = (t: number, from = t) => `${Math.max(0, Math.floor((t - from) / 60000))} min`;
export function RoomCard({ d, r, t, send, pick, onPicked, big, also }: { d: Drive; r: Room; t: number; send: Send; pick?: Student | null; onPicked?: () => void; big?: boolean; also?: Seen }) {
  const [over, setOver] = useState(false);
  const s = occ(d, r), k = s ? s.status : 'free', h = s?.hist[s.hist.length - 1];
  const go = !s && pick && fits(r, pick) ? pick : null; // the student being called (by Call or by dragging), if this cabin can take them
  if (over && !go) setOver(false); // the call ended mid-drag
  // on the board the whole card is one button: it ends the interview inside, or takes the student being called;
  // while someone is being called, the cabins that can't take them ignore the mouse
  const tap = big ? null : s ? (pick ? null : s) : go;
  const call = () => { if (go) send({ type: 'call', id: go.id, room: r.id }); onPicked?.() };
  const drop = go ? {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setOver(true) },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setOver(false); call() },
  } : {};
  return (
    <div className={`room ${k}${tap ? ' tap' : ''}${pick && !go ? ' off' : ''}${go ? ' target' : ''}${over ? ' over' : ''}${big ? ' big' : ''}`} {...drop}>
      <div className="rh">
        <b>{r.name}</b>
        {r.panel && <span className="iv" title={`Interviewer: ${r.panel}`}>{r.panel}</span>}
        <span className="rr" title="Rounds this cabin takes (change in Settings)">{roundsLabel(d, r)}</span>
      </div>
      <div className="rb">
        {s && h ? <>
          <div className="who" title={s.name}>{s.name}</div>
          <div className="info" title={`In since ${tm(h.in)}`}><Camp c={s.campus} />{rname(d, h.r)} · {mins(t, h.in)}<AlsoIn a={also?.[s.id]} /></div>
          {big && <div className="acts"><button onClick={() => send({ type: 'out', id: s.id })}><Icon n="check" s={15} />Exited</button></div>}
        </> : <div className="avail"><b>{over ? 'Drop to call here' : 'Available'}</b>{!pick && !big && <span>Drag a name here, or press Call</span>}</div>}
        {tap && <b className="go">{s ? 'Exited' : 'Send here'}</b>}
      </div>
      {tap && <button className="send" aria-label={s ? `${tap.name} exited ${r.name}` : `Send ${tap.name} to ${r.name}`}
        onClick={() => s ? send({ type: 'out', id: s.id }) : call()} />}
    </div>
  );
}

type Tab = number | 'final';

// campus tag; nothing when the student has no campus
export const Camp = ({ c }: { c: string }) => c ? <span className={`camp c-${c}`}>{c}</span> : null;

// One queue per round, shown as tabs: a student sits in the queue of the round they go in for next (round index = done).
// Straight out of an interview they wait there as "awaiting result" with ✓ / ✗; ✓ makes them callable.
function QueuePanel({ d, send, sel, setSel, also }: { d: Drive; send: Send; sel: string | null; setSel: (id: string | null) => void; also?: Seen }) {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<Tab | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const L = d.rounds.length;
  const inQueue = d.students.filter(s => s.status === 'waiting' || s.status === 'pending').sort((a, b) => a.t - b.t);
  const of = (t: Tab) => inQueue.filter(s => t === 'final' ? s.done >= L : s.done === t);
  const tabs: Tab[] = [...d.rounds.keys(), ...(of('final').length ? ['final' as const] : [])];
  // until a tab is picked, show the first round that has someone to call
  const cur = tab !== null && tabs.includes(tab) ? tab : tabs.find(t => of(t).some(s => s.status === 'waiting')) ?? tabs.find(t => of(t).length) ?? 0;
  const match = (s: Student) => `${s.reg} ${s.name} ${s.campus}`.toLowerCase().includes(q.toLowerCase());
  const list = q ? inQueue.filter(match) : of(cur);
  const decide = (s: Student) => s.status === 'pending' || (s.status === 'waiting' && s.done >= L);
  const ready = list.filter(s => s.status === 'waiting' && !decide(s)), pend = list.filter(decide);
  const due = upNext(d); // Call shows for the top students, one per free cabin of their round; the rest appear on hover (a panel may ask for someone)
  // hovering or picking someone further down hides the last of the top ones in that round, so the Calls showing still match the free cabins
  const other = [hover, sel].map(id => inQueue.find(s => s.id === id)).find(s => s?.status === 'waiting' && !due.has(s.id));
  const edge = other && inQueue.filter(s => due.has(s.id) && s.done === other.done).at(-1)?.id;
  const toggle = (s: Student) => setSel(sel === s.id || !roundOpen(d, s.done) ? null : s.id);
  const act = (e: React.MouseEvent, a: Parameters<Send>[0]) => { e.stopPropagation(); send(a) };

  const readyRow = (s: Student, i: number) => {
    const open = roundOpen(d, s.done);
    return (
      <div key={s.id}>
        <div className={`qr${sel === s.id ? ' sel' : ''}`} draggable={open} onDragStart={e => { e.dataTransfer.setData('text/plain', s.id); setTimeout(() => setSel(s.id)) }} onDragEnd={() => setSel(null)} onClick={() => toggle(s)}
          onMouseEnter={() => setHover(s.id)} onMouseLeave={() => setHover(null)}>
          {!q && <span className="num">{i + 1}</span>}
          <span className="nm" title={s.name}>{s.name}</span><AlsoIn a={also?.[s.id]} />
          {q && <span className="sub">{rname(d, s.done)}</span>}
          <button className={`sm${sel === s.id ? '' : due.has(s.id) && s.id !== edge ? ' primary' : ' primary later'}`} disabled={!open && sel !== s.id} title={open ? undefined : `All ${rname(d, s.done)} cabins are busy`}
            onClick={e => { e.stopPropagation(); toggle(s) }}>{sel === s.id ? 'Cancel' : 'Call'}</button>
        </div>
      </div>
    );
  };
  const pendRow = (s: Student) => {
    const prev = rname(d, s.done - 1), last = s.done >= L;
    return (
      <div key={s.id} className="qr pend">
        <span className="nm" title={s.name}>{s.name}</span><AlsoIn a={also?.[s.id]} />
        <span className="sub">{prev} result</span>
        <button className="sm icon success" title={last ? 'Selected' : `Cleared ${prev}: stays in ${rname(d, s.done)}`} onClick={e => act(e, { type: 'move', id: s.id, to: last ? 'selected' : 'waiting' })}><Icon n="check" s={13} /></button>
        <button className="sm icon danger" title={`Rejected after ${prev}`} onClick={e => act(e, { type: 'move', id: s.id, to: 'rejected' })}><Icon n="x" s={13} /></button>
      </div>
    );
  };

  return (
    <aside className="side">
      <div className="side-top">
        <label className="search"><Icon n="search" s={14} /><input type="search" placeholder="Search students" value={q} onChange={e => setQ(e.target.value)} aria-label="Search students" /></label>
        {!q && <div className="seg" role="tablist">
            {tabs.map(t => {
              const l = of(t), p = l.filter(decide).length;
              return (
                <button key={String(t)} role="tab" aria-selected={cur === t} className={cur === t ? 'on' : ''} onClick={() => setTab(t)}
                  title={t === 'final' ? 'Final result' : rname(d, t)}>
                  <span className="tl">{t === 'final' ? 'Final' : `R${t + 1}`}</span>
                  <span className="cnt">{l.length - p}</span>
                  {p > 0 && <span className="cnt pend" title={`${p} awaiting result`}>{p}</span>}
                </button>
              );
            })}
        </div>}
      </div>
      <div className="qlist">
        {!q && <div className="qtitle">{cur === 'final' ? `Final result · after ${rname(d, L - 1)}` : `${rname(d, cur)} queue`}</div>}
        {ready.length > 0 && <><div className="qsub">Ready to call{!q && cur !== 'final' && !roundOpen(d, cur) && <em>All cabins busy</em>}<span>{ready.length}</span></div>{ready.map(readyRow)}</>}
        {pend.length > 0 && <><div className="qsub">Awaiting result<span>{pend.length}</span></div>{pend.map(pendRow)}</>}
        {!list.length && <div className="empty">{q ? 'No match' : 'Nobody in this queue'}</div>}
      </div>
    </aside>
  );
}

export function Board({ d, send, also }: { d: Drive; send: Send; also?: Seen }) {
  const [sel, setSel] = useState<string | null>(null);
  const [gridRef, gridStyle] = useFit(d.rooms.length, { w: 240, h: 150 }, { w: 170, h: 112 });
  const t = useNow(); // minutes each interview has been running
  // a pick goes stale once that student is called or no longer ready
  const pick = d.students.find(s => s.id === sel && s.status === 'waiting' && roundOpen(d, s.done)) ?? null;
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setSel(null) };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);

  return (
    <div className="board">
      <section className="cabins">
        <div className="grid" ref={gridRef} style={gridStyle}>
          {d.rooms.map(r => <RoomCard key={r.id} d={d} r={r} t={t} send={send} pick={pick} onPicked={() => setSel(null)} also={also} />)}
        </div>
      </section>
      <QueuePanel d={d} send={send} sel={pick?.id ?? null} setSel={setSel} also={also} />
    </div>
  );
}
