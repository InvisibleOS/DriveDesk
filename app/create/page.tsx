'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { KINDS, ORDER, PHASES, SHORT, lead, type Campus, type Kind, type Phase, type PhaseKey, type Row } from '@/lib/drive';
import { StudentImport } from '../panels';
import { PICON, PhaseColumns } from '../phases';
import { Icon, TopBar, post, toast, usePeople } from '../ui';

// Configuring a new drive: the company, its type, which phases it has (always in the same order) with where and when
// each happens and its volunteers, and the list of students. Creating it opens the drive dashboard; interviews are set up there on the day.
export default function Create() {
  const router = useRouter();
  const [company, setCompany] = useState('');
  const [kind, setKind] = useState<Kind | ''>('');
  const [on, setOn] = useState<PhaseKey[]>(['int']);
  const [info, setInfo] = useState<Record<PhaseKey, Phase>>(() => Object.fromEntries(ORDER.map(k => [k, { k, venue: '', at: '', crew: [] as string[] }])) as Record<PhaseKey, Phase>);
  const [rows, setRows] = useState<Row[]>([]); // the students: required, every phase draws on them
  const [fallback, setFallback] = useState<Campus>('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { // from a day on the calendar: that day, 9 in the morning
    const qd = new URLSearchParams(window.location.search).get('date');
    if (qd && /^\d{4}-\d{2}-\d{2}$/.test(qd)) setInfo(i => Object.fromEntries(ORDER.map(k => [k, { ...i[k], at: `${qd}T09:00` }])) as Record<PhaseKey, Phase>);
  }, []);
  const people = usePeople();
  if (people && !lead(people.me)) return ( // seniors create drives; a junior reaching this page by its address is sent back
    <div className="app">
      <TopBar title="New drive" />
      <main><div className="emptyst"><div><h2>Only senior members create drives</h2><p className="meta">Every drive shows on your dashboard, and you can volunteer at the ones coming up.</p></div>
        <div className="row"><Link className="btn" href="/"><Icon n="left" />All drives</Link></div></div></main>
    </div>
  );
  const phases = ORDER.filter(k => on.includes(k)).map(k => info[k]);
  const flip = (k: PhaseKey) => on.includes(k) ? on.length > 1 ? setOn(on.filter(x => x !== k)) : toast('A drive needs at least one phase', true) : setOn([...on, k]);
  const create = async () => {
    if (!company.trim()) return toast('Enter the company name', true);
    if (!kind) return toast('Pick the type of drive', true);
    if (!rows.length) return toast('Upload the list of students', true);
    if (!fallback && !rows.every(r => r.campus)) return toast('Every student needs a campus: pick BLR or MPL for the ones without one', true);
    setBusy(true);
    const students = rows.map(r => ({ ...r, campus: r.campus || fallback }));
    try { router.push(`/drive/${(await post<{ id: string }>('/api/drives', { company, plan: { kind, phases, students } })).id}`) }
    catch { setBusy(false) }
  };

  const missing = !company.trim() ? 'Enter the company name' : !kind ? 'Pick the type of drive' : !rows.length ? 'Upload the list of students' : '';

  return (
    <div className="app">
      <TopBar title="New drive"><Link className="btn ghost" href="/">Cancel</Link></TopBar>
      <main className="cfg-main">
        <div className="cfg">
          <div className="cfg-head">
            <h1>New drive</h1>
            <p className="meta">The company, its phases and the students. Phases you aren&rsquo;t sure about yet can be added later, from the drive&rsquo;s page.</p>
          </div>

          <Section title="Company" note="How the drive shows on the dashboard. Both stay fixed once it is created.">
            <label className="field">Company name
              <input autoFocus value={company} onChange={e => setCompany(e.target.value)} placeholder="e.g. Optum" maxLength={80} />
            </label>
            <div className="field">Type of drive
              <div className="seg kind" role="radiogroup" aria-label="Type of drive">
                {(Object.keys(KINDS) as Kind[]).map(k => <button key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{KINDS[k]}</button>)}
              </div>
            </div>
          </Section>

          <Section title="Phases" note="They always run in this order. Only students present at a phase go on to the next one.">
            <div className="ppick">{ORDER.map(k => (
              <label key={k} className={on.includes(k) ? 'on' : ''}>
                <span className="pico"><Icon n={PICON[k]} s={16} /></span>
                <span><b>{PHASES[k]}</b><small>{BLURB[k]}</small></span>
                <input type="checkbox" checked={on.includes(k)} onChange={() => flip(k)} />
              </label>
            ))}</div>
            <PhaseColumns phases={phases} onChange={(k, p) => setInfo({ ...info, [k]: { ...info[k], ...p } })} />
          </Section>

          <Section title="Students" note="Everyone who can take part, from a CSV or Excel sheet.">
            <StudentImport rows={rows} setRows={setRows} fallback={fallback} setFallback={setFallback} />
          </Section>
        </div>
      </main>
      <footer className="cfg-foot">
        <div className="cfg-sum">{company.trim() ? <b>{company.trim()}</b> : <span className="faint">Untitled drive</span>}
          <span>{phases.map(p => SHORT[p.k] === 'interviews' ? 'Interviews' : SHORT[p.k]).join(' → ')}</span>
          {rows.length > 0 && <span>{rows.length} students</span>}</div>
        <Link className="btn ghost hide-sm" href="/">Cancel</Link>
        <button className="primary" disabled={busy} onClick={create} title={missing || undefined}>{busy ? 'Creating…' : 'Create drive'}<Icon n="right" /></button>
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
