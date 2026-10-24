'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { allRounds, localDate, type Campus, type Row } from '@/lib/drive';
import { LocationPick, StudentImport } from '../panels';
import { Icon, TopBar, longDate, post, toast, withPin } from '../ui';

const STEPS = ['Drive details', 'Rounds', 'Cabins', 'Students'];
const HINTS = ['Company, date and place', 'How many, in order', 'Interviewers and their rounds', 'Upload the list'];
type Cabin = { panel: string; rounds: number[] }; // panel = interviewer

// Onboarding: a few questions, then the drive starts and opens its board.
// A drive on a later day is only created (company + date); ?id=<drive> finishes its setup on the day.
export default function NewDrive() {
  const router = useRouter();
  const [step, go] = useState(0);
  const [far, setFar] = useState(0); // furthest step opened, so unvisited steps don't show a tick
  const setStep = (i: number) => { go(i); setFar(f => Math.max(f, i)) };
  const [company, setCompany] = useState('');
  const [date, setDate] = useState(() => localDate(Date.now()));
  const [location, setLocation] = useState('');
  const [rounds, setRounds] = useState(['Round 1', 'Round 2']);
  const [cabins, setCabins] = useState<Cabin[]>(() => allRounds(6).map(() => ({ panel: '', rounds: allRounds(2) })));
  const [rows, setRows] = useState<Row[]>([]);
  const [fallback, setFallback] = useState<Campus>('');
  const [busy, setBusy] = useState(false);
  const [id, setId] = useState(''); // setting up a drive created earlier
  const [made, setMade] = useState(''); // id of the drive just created for a later day
  useEffect(() => {
    const q = new URLSearchParams(window.location.search), qd = q.get('date'), qi = q.get('id');
    if (qd && /^\d{4}-\d{2}-\d{2}$/.test(qd)) setDate(qd);
    if (qi) fetch(withPin(`/api/drives/${qi}?once=1`)).then(r => r.json()).then(({ drive }) => {
      if (drive?.status !== 'planned') return router.replace(`/drive/${qi}`);
      setId(qi); setCompany(drive.company); setDate(drive.date); setLocation(drive.location ?? '');
    }).catch(() => toast('Could not load that drive', true));
  }, [router]);
  const later = date > localDate(Date.now());

  const setRoundCount = (n: number) => {
    const old = rounds.length;
    setRounds(allRounds(n).map(i => rounds[i] ?? `Round ${i + 1}`));
    // cabins that took every round keep taking every round
    setCabins(cabins.map(c => { const r = c.rounds.length === old ? allRounds(n) : c.rounds.filter(i => i < n); return { ...c, rounds: r.length ? r : allRounds(n) } }));
  };
  const addCabin = () => cabins.length < 60 && setCabins([...cabins, { panel: '', rounds: allRounds(rounds.length) }]);
  const delCabin = (ci: number) => cabins.length > 1 ? setCabins(cabins.filter((_, i) => i !== ci)) : toast('Keep at least one cabin', true);
  const toggle = (ci: number, r: number) => setCabins(cabins.map((c, i) => {
    if (i !== ci) return c;
    const has = c.rounds.includes(r);
    if (has && c.rounds.length === 1) { toast(`Cabin ${ci + 1} needs at least one round`, true); return c }
    return { ...c, rounds: has ? c.rounds.filter(x => x !== r) : [...c.rounds, r].sort((a, b) => a - b) };
  }));
  const valid = [!!company.trim() && !!date && !!location, rounds.length > 0, cabins.length > 0, !!fallback || rows.every(r => r.campus)];
  const filled = [valid[0], rounds.every(r => r.trim()), cabins.every(c => c.panel.trim()), rows.length > 0 && valid[3]];
  const ticked = (i: number) => !!made || (filled[i] && i <= far);
  const reachable = (i: number) => valid.slice(0, i).every(Boolean);
  const next = () => valid[step] ? setStep(step + 1) : toast(step ? 'Fill this in first' : !company.trim() ? 'Enter the company name' : !location ? 'Pick the location' : 'Pick the date', true);
  const start = async () => {
    if (!valid[3]) return toast('Every student needs a campus: pick BLR or MPL for the ones without one', true);
    setBusy(true);
    const config = { company, date, location, rounds, rooms: cabins, students: rows.map(r => ({ ...r, campus: r.campus || fallback })) };
    try {
      if (id) await post(`/api/drives/${id}`, { type: 'setup', config });
      router.push(`/drive/${id || (await post<{ id: string }>('/api/drives', config)).id}`);
    } catch { setBusy(false) }
  };
  const create = async () => {
    if (!valid[0]) return next();
    setBusy(true);
    try {
      if (id) { await post(`/api/drives/${id}`, { type: 'company', name: company }); await post(`/api/drives/${id}`, { type: 'date', date }); await post(`/api/drives/${id}`, { type: 'location', location }) }
      setMade(id || (await post<{ id: string }>('/api/drives', { company, date, location })).id);
    } catch { /* already shown */ }
    setBusy(false);
  };

  return (
    <div className="app">
      <TopBar title={id ? company : 'New drive'} badge={id ? <span className="pill warn">Setting up</span> : null}>
        <Link className="btn ghost" href="/">Cancel</Link>
      </TopBar>
      <main>
        <div className="wiz">
          <nav className="steps" aria-label="Steps">
            {(later ? STEPS.slice(0, 1) : STEPS).map((s, i) => (
              <button key={s} className={`step${i === step && !made ? ' on' : ''}${ticked(i) ? ' done' : ''}`} disabled={!reachable(i)} onClick={() => setStep(i)} aria-current={i === step && !made ? 'step' : undefined}>
                <i>{ticked(i) ? <Icon n="check" s={13} /> : i + 1}</i><span><b>{s}</b><small>{HINTS[i]}</small></span>
              </button>
            ))}
          </nav>

          <section className="wcard">
            {made ? <>
              <div className="wbody created">
                <span className="okmark"><Icon n="check" s={20} /></span>
                <h2>Drive created</h2>
                <p className="meta"><b>{company}</b> is scheduled for {longDate(date)} at {location}. On the day, open it to set up rounds, cabins and students.</p>
              </div>
              <div className="wfoot">
                <div className="sp" />
                <Link className="btn" href={`/drive/${made}`}>View drive</Link>
                <Link className="btn primary" href="/">Back to dashboard</Link>
              </div>
            </> : <>
            <div className="wbody">
              {!later && <span className="eyebrow">Step {step + 1} of {STEPS.length}</span>}
              {step === 0 && <>
                <h2>Which company is visiting?</h2>
                <p className="meta">This is how the drive appears on the dashboard and in the calendar.</p>
                <label className="field">Company name
                  <input autoFocus value={company} onChange={e => setCompany(e.target.value)} onKeyDown={e => e.key === 'Enter' && (later ? create() : next())} placeholder="e.g. Optum" maxLength={80} />
                </label>
                <label className="field">Date of the drive<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
                <div className="field">Location<LocationPick value={location} onPick={setLocation} /></div>
                {later && <p className="meta">This drive is on a later day, so it is only created now. You will set up rounds, cabins and students on the day.</p>}
              </>}

              {step === 1 && <>
                <h2>How many rounds are there?</h2>
                <p className="meta">Students go through them in this order. Rename them if you like, e.g. Aptitude, Technical, HR.</p>
                <div className="nums">{[1, 2, 3, 4, 5, 6].map(n => <button key={n} className={rounds.length === n ? 'on' : ''} onClick={() => setRoundCount(n)}>{n}</button>)}</div>
                <div className="rlist">
                  {rounds.map((r, i) => (
                    <div key={i} className="line"><span className="num">R{i + 1}</span>
                      <input value={r} maxLength={40} onChange={e => setRounds(rounds.map((x, j) => j === i ? e.target.value : x))} aria-label={`Name of round ${i + 1}`} />
                    </div>
                  ))}
                </div>
              </>}

              {step === 2 && <>
                <h2>Which cabins take which rounds?</h2>
                <p className="meta">Tick the rounds each cabin conducts. When you call a student, cabins for their round are suggested first.</p>
                <div className="row"><span className="meta"><b>{cabins.length}</b> cabin{cabins.length === 1 ? '' : 's'}</span><div className="sp" /><button onClick={addCabin}><Icon n="plus" />Add cabin</button></div>
                <div className="scroll matrix">
                  <table>
                    <thead><tr><th className="cb n">Cabin</th><th>Interviewer</th>{rounds.map((r, i) => <th key={i} className="cb" title={r}>R{i + 1}<small>{r !== `Round ${i + 1}` ? ` ${r}` : ''}</small></th>)}</tr></thead>
                    <tbody>
                      {cabins.map((c, ci) => (
                        <tr key={ci}>
                          <td className="cb n"><span className="sn">{ci + 1}</span><button className="icon sm ghost rmx" onClick={() => delCabin(ci)} title="Remove cabin" aria-label={`Remove Cabin ${ci + 1}`}><Icon n="x" s={12} /></button></td>
                          <td><input value={c.panel} maxLength={60} placeholder="Interviewer name" onChange={e => setCabins(cabins.map((x, j) => j === ci ? { ...x, panel: e.target.value } : x))} aria-label={`Cabin ${ci + 1} interviewer`} /></td>
                          {rounds.map((r, i) => <td key={i} className="cb"><input type="checkbox" checked={c.rounds.includes(i)} onChange={() => toggle(ci, i)} aria-label={`Cabin ${ci + 1} takes ${r}`} /></td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>}

              {step === 3 && <>
                <h2>Upload the student list</h2>
                <p className="meta">We only keep each student&apos;s registration number, name and campus, exactly as they are in the file.</p>
                <StudentImport rows={rows} setRows={setRows} fallback={fallback} setFallback={setFallback} />
              </>}
            </div>
            <div className="wfoot">
              {step > 0 && <button onClick={() => setStep(step - 1)}><Icon n="left" />Back</button>}
              <div className="sp" />
              {later
                ? <button className="primary" disabled={busy} onClick={create}>{id ? 'Save' : 'Create drive'}<Icon n="right" /></button>
                : step < STEPS.length - 1
                ? <button className="primary" onClick={next}>Continue<Icon n="right" /></button>
                : <button className="primary" disabled={busy} onClick={start}>{busy ? 'Starting…' : 'Start drive'}<Icon n="right" /></button>}
            </div>
            </>}
          </section>
        </div>
      </main>
    </div>
  );
}
