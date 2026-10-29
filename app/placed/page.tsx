'use client';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import type { Campus, Placed } from '@/lib/drive';
import { Camp } from '../board';
import { DeskMenu, Icon, PageHead, Stat, TopBar, longDate, usePlaced } from '../ui';

// Who has been placed and where: the committee's list from before DriveDesk, and everyone selected in a drive since.
// Read-only: a student joins it by being selected in a drive. Companies on the left filter the table.
export default function PlacedPage() {
  const list = usePlaced();
  const [q, setQ] = useState(''), [camp, setCamp] = useState<Campus>(''), [co, setCo] = useState('');
  const term = useDeferredValue(q.trim().toLowerCase());
  const all = list ?? [];
  const companies = [...all.reduce((m, p) => m.set(p.company, (m.get(p.company) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shown = all.filter(p => (!co || p.company === co) && (!camp || p.campus === camp)
    && (!term || p.name.toLowerCase().includes(term) || p.reg.includes(term) || p.company.toLowerCase().includes(term)))
    .sort((a, b) => a.company.localeCompare(b.company) || a.name.localeCompare(b.name));
  const n = (c: Campus) => all.filter(p => p.campus === c).length;

  return (
    <div className="app">
      <TopBar title="Placed students"><DeskMenu /></TopBar>
      <main className="placed">
        <PageHead title="Placed students" meta={<p className="meta">Everyone placed so far: the committee&rsquo;s list from before DriveDesk, and everyone selected in a drive since. New drives leave them out.</p>}>
          <div className="stats">
            <Stat label="Placed" value={list ? all.length : '–'} />
            <Stat label="BLR" value={list ? n('BLR') : '–'} />
            <Stat label="MPL" value={list ? n('MPL') : '–'} />
            <Stat label="Companies" value={list ? companies.length : '–'} />
          </div>
        </PageHead>
        <div className="pl-grid">
          <nav className="panel pl-cos" aria-label="Companies">
            <h3 className="sect-t">Companies<span>{companies.length}</span></h3>
            <div className="scroll">
              <button className={co ? '' : 'on'} onClick={() => setCo('')}><span>All companies</span><b>{all.length}</b></button>
              {companies.map(([c, k]) => <button key={c} className={co === c ? 'on' : ''} onClick={() => setCo(co === c ? '' : c)}><span title={c}>{c}</span><b>{k}</b></button>)}
            </div>
          </nav>
          <section className="panel pl-list">
            <div className="panel-bar">
              <label className="search pl-q"><Icon n="search" s={14} /><input type="search" placeholder="Search name, reg. no. or company" value={q} onChange={e => setQ(e.target.value)} aria-label="Search placed students" /></label>
              <div className="seg" role="radiogroup" aria-label="Campus">{(['', 'BLR', 'MPL'] as Campus[]).map(c =>
                <button key={c || 'all'} role="radio" aria-checked={camp === c} className={camp === c ? 'on' : ''} onClick={() => setCamp(c)}>{c || 'Both'}</button>)}</div>
              <div className="sp" /><span className="meta">{shown.length} shown</span>
            </div>
            <div className="scroll"><table>
              <thead><tr><th>Name</th><th>Reg. no.</th><th>Campus</th><th>Company</th><th className="hide-sm">Placed</th></tr></thead>
              <tbody>
                {shown.map(p => (
                  <tr key={p.reg}>
                    <td><b>{p.name}</b></td><td className="reg">{p.reg}</td><td><Camp c={p.campus} /></td><td>{p.company}</td>
                    <td className="meta hide-sm">{p.drive ? <Link href={`/drive/${p.drive}`} title="Open the drive">{longDate(p.date)}</Link> : p.date ? longDate(p.date) : 'Before DriveDesk'}</td>
                  </tr>
                ))}
                {!list && <tr><td colSpan={5} className="empty">Loading…</td></tr>}
                {list && !shown.length && <tr><td colSpan={5} className="empty">{all.length ? 'Nobody matches' : 'Nobody placed yet'}</td></tr>}
              </tbody>
            </table></div>
          </section>
        </div>
      </main>
    </div>
  );
}
