'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { KINDS, ORDER, PHASES, lead, shortOf, type Campus, type Drive, type Kind, type Phase, type PhaseKey, type Row } from '@/lib/drive';
import { StudentImport } from '../panels';
import { PICON, PhaseColumns } from '../phases';
import { Icon, Stepper, TopBar, post, toast, usePeople, usePlaced } from '../ui';

// Configuring a new drive: the company, its type, which phases it has (always in the same order) with where and when
// each happens and its volunteers, and the list of students. Creating it opens the drive dashboard; interviews are set up there on the day.
export default function Create() {
  const router = useRouter();
  const [company, setCompany] = useState('');
  const [kind, setKind] = useState<Kind | ''>('');
  // the phases, in order: the talk, any number of OAs, the interviews; 'oa', 'oa2'… as the engine names them
  const [phases, setPhases] = useState<Phase[]>([{ id: 'int', k: 'int', venue: '', at: '', crew: [] }]);
  const [day, setDay] = useState('');
  const [rows, setRows] = useState<Row[]>([]); // the students: required, every phase draws on them
  const [fallback, setFallback] = useState<Campus>('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { // from a day on the calendar: that day, 9 in the morning
    const qd = new URLSearchParams(window.location.search).get('date');
    if (qd && /^\d{4}-\d{2}-\d{2}$/.test(qd)) { setDay(qd); setPhases(ph => ph.map(p => ({ ...p, at: `${qd}T09:00` }))) }
  }, []);
  const people = usePeople(), placedList = usePlaced();
  const placed = new Map((placedList ?? []).map(p => [p.reg, p])), kept = rows.filter(r => !placed.has(r.reg)); // placed students are left out
  if (people && !lead(people.me)) return ( // seniors create drives; a junior reaching this page by its address is sent back
    <div className="app">
      <TopBar title="New drive" />
      <main><div className="emptyst"><div><h2>Only senior members create drives</h2><p className="meta">Every drive shows on your dashboard, and you can volunteer at the ones coming up.</p></div>
        <div className="row"><Link className="btn" href="/"><Icon n="left" />All drives</Link></div></div></main>
    </div>
  );
  const blank = (k: PhaseKey, id: string): Phase => ({ id, k, venue: '', at: day ? `${day}T09:00` : '', crew: [] });
  const inOrder = (ph: Phase[]) => ORDER.flatMap(k => ph.filter(p => p.k === k));
  const has = (k: PhaseKey) => phases.some(p => p.k === k), oas = phases.filter(p => p.k === 'oa').length;
  const flip = (k: PhaseKey) => !has(k) ? setPhases(inOrder([...phases, blank(k, k)]))
    : phases.some(p => p.k !== k) ? setPhases(phases.filter(p => p.k !== k)) : toast('A drive needs at least one phase', true);
  const moreOA = () => setPhases(inOrder([...phases, blank('oa', `oa${oas + 1}`)]));
  const lessOA = () => setPhases(phases.filter(p => p !== phases.findLast(x => x.k === 'oa')));
  const create = async () => {
    if (!company.trim()) return toast('Enter the company name', true);
    if (!kind) return toast('Pick the type of drive', true);
    if (!rows.length) return toast('Upload the list of students', true);
    if (!kept.length) return toast('Everyone on this list is already placed', true);
    if (!fallback && !kept.every(r => r.campus)) return toast('Every student needs a campus: pick BLR or MPL for the ones without one', true);
    setBusy(true);
    const students = kept.map(r => ({ ...r, campus: r.campus || fallback }));
    try { router.push(`/drive/${(await post<{ id: string }>('/api/drives', { company, plan: { kind, phases, students } })).id}`) }
    catch { setBusy(false) }
  };

  const missing = !company.trim() ? 'Enter the company name' : !kind ? 'Pick the type of drive' : !rows.length ? 'Upload the list of students' : !kept.length ? 'Everyone on this list is already placed' : '';

  return (
    <div className="app">
      <TopBar title="New drive"><Link className="btn ghost" href="/">Cancel</Link></TopBar>
      <main className="cfg-main">
        <div className="cfg">
          <div className="cfg-head">
            <h1>New drive</h1>
            <p className="meta">The company, its phases and the students. Phases you aren&rsquo;t sure about yet can be added later, from the drive&rsquo;s page.</p>
          </div>

          <Section title="Company" note="How the drive shows on the dashboard. Both can be changed later from the gear on the drive’s page.">
            <label className="field">Company name
              <input autoFocus value={company} onChange={e => setCompany(e.target.value)} placeholder="e.g. Optum" maxLength={80} />
            </label>
            <div className="field">Type of drive
              <div className="seg kind" role="radiogroup" aria-label="Type of drive">
                {(Object.keys(KINDS) as Kind[]).map(k => <button key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{KINDS[k]}</button>)}
              </div>
            </div>
          </Section>

          <Section title="Phases" note="The PPT always comes first. Each OA and the interviews take either those present at the phase before them or the company’s shortlist, chosen on the drive’s page before their attendance.">
            <div className="ppick">{ORDER.map(k => (
              <label key={k} className={has(k) ? 'on' : ''}>
                <span className="pico"><Icon n={PICON[k]} s={16} /></span>
                <span><b>{PHASES[k]}</b><small>{BLURB[k]}</small></span>
                <input type="checkbox" checked={has(k)} onChange={() => flip(k)} />
              </label>
            ))}</div>
            {oas > 0 && <div className="pmore">
              <span className="pm-oa">Online assessments<Stepper label="Online assessments" value={oas} min={1} max={9} less={lessOA} more={moreOA} /></span>
            </div>}
            <PhaseColumns phases={phases} onChange={(id, p) => setPhases(phases.map(x => x.id === id ? { ...x, ...p } : x))} />
          </Section>

          <Section title="Students" note="Everyone who can take part, from a CSV or Excel sheet.">
            <StudentImport rows={rows} setRows={setRows} fallback={fallback} setFallback={setFallback} placed={placed} />
          </Section>
        </div>
      </main>
      <footer className="cfg-foot">
        <div className="cfg-sum">{company.trim() ? <b>{company.trim()}</b> : <span className="faint">Untitled drive</span>}
          <span>{phases.map(p => { const n = shortOf({ phases } as Drive, p); return n[0].toUpperCase() + n.slice(1) }).join(' → ')}</span>
          {kept.length > 0 && <span>{kept.length} students</span>}</div>
        <Link className="btn ghost hide-sm" href="/">Cancel</Link>
        <button className="primary" disabled={busy || !placedList} onClick={create} title={missing || undefined}>{busy ? 'Creating…' : 'Create drive'}<Icon n="right" /></button>
      </footer>
    </div>
  );
}

// one line under each phase in the picker
const BLURB: Record<PhaseKey, string> = { ppt: 'The company presents to the students', oa: 'A test that decides who interviews', int: 'Rounds in cabins, on the day' };

// one part of the form: its name and a line about it on the left, its fields on the right
const Section = ({ title, note, children }: { title: string; note: string; children: React.ReactNode }) => (
  <section className="cfg-sec">
    <div className="cfg-l"><h2>{title}</h2><p className="meta">{note}</p></div>
    <div className="cfg-r">{children}</div>
  </section>
);
