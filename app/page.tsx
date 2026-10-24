'use client';
import Link from 'next/link';
import { useState } from 'react';
import { localDate, type Summary } from '@/lib/drive';
import { DeskMenu, Icon, TopBar, longDate, tm, useDrives } from './ui';

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// 6 weeks × 7 days covering the month ('YYYY-MM'), Monday first
function monthDays(month: string) {
  const [y, m] = month.split('-').map(Number), lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => localDate(new Date(y, m - 1, 1 - lead + i).getTime()));
}
const shift = (month: string, by: number) => { const [y, m] = month.split('-').map(Number); return localDate(new Date(y, m - 1 + by, 1).getTime()).slice(0, 7) };
const monthName = (month: string) => new Date(`${month}-01T00:00`).toLocaleDateString([], { month: 'long', year: 'numeric' });

export default function Dashboard() {
  const { list, gate } = useDrives();
  const today = localDate(Date.now());
  const [sel, setSel] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  if (gate || !list) return gate;

  const byDate = new Map<string, Summary[]>();
  for (const s of list) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  const live = list.filter(s => s.status === 'live');
  const inMonth = list.filter(s => s.date.startsWith(month));
  const total = (k: 'students' | 'blrSelected') => inMonth.reduce((a, s) => a + s[k], 0);
  // today also lists drives from earlier days that are still open (running, or never set up), so they are one click away
  const earlier = sel === today ? list.filter(s => s.date < today && s.status !== 'done') : [];
  const dayDrives = [...earlier, ...(byDate.get(sel) ?? [])];
  const pick = (day: string) => { setSel(day); setMonth(day.slice(0, 7)) };

  return (
    <div className="app">
      <TopBar>
        <Link className="btn primary" href="/new"><Icon n="plus" />New drive</Link>
        <DeskMenu />
      </TopBar>
      <main className="dash">
        <div className="phead">
          <div>
            <h1>Drives</h1>
            <p className="meta">{longDate(today)} · {live.length ? `${live.length} in progress` : 'No drive running right now'}</p>
          </div>
          <div className="stats">
            <div className="stat"><span>Drives in {monthName(month).split(' ')[0]}</span><b>{inMonth.length}<small>{inMonth.filter(s => s.status === 'live').length} in progress</small></b></div>
            <div className="stat"><span>Students</span><b>{total('students')}</b></div>
            <div className="stat ok"><span>BLR selected</span><b>{total('blrSelected')}<small>this month</small></b></div>
            <div className="stat"><span>All drives</span><b>{list.length}<small>since you started</small></b></div>
          </div>
        </div>

        <div className="cal-wrap">
          <section className="card cal">
            <div className="cal-head">
              <h2>{monthName(month)}</h2>
              <div className="sp" />
              <div className="group">
                <button className="icon" onClick={() => setMonth(shift(month, -1))} aria-label="Previous month"><Icon n="prev" /></button>
                <button onClick={() => pick(today)}>Today</button>
                <button className="icon" onClick={() => setMonth(shift(month, 1))} aria-label="Next month"><Icon n="next" /></button>
              </div>
            </div>
            <div className="cal-grid">
              {WEEK.map(w => <div key={w} className="dow">{w}</div>)}
              {monthDays(month).map(day => {
                const ds = byDate.get(day) ?? [];
                return (
                  <button key={day} className={`day${day.slice(0, 7) !== month ? ' out' : ''}${day === today ? ' today' : ''}${day === sel ? ' sel' : ''}`}
                    onClick={() => pick(day)} aria-label={`${longDate(day)}: ${ds.length} drive${ds.length === 1 ? '' : 's'}`} aria-pressed={day === sel}>
                    <span className="dh"><span className="dn">{+day.slice(8)}</span>{ds.length > 2 && <span className="more">+{ds.length - 2} more</span>}</span>
                    {ds.slice(0, 2).map(s => <span key={s.id} className={`chip ${s.status}`}>{s.company}</span>)}
                  </button>
                );
              })}
            </div>
          </section>

          <aside className="card dayp">
            <div className="dayp-h">
              <h2>{sel === today ? 'Today' : longDate(sel)}</h2>
              <p className="meta">{sel === today && `${longDate(today)} · `}{dayDrives.length ? `${dayDrives.length} drive${dayDrives.length > 1 ? 's' : ''}` : 'No drives'}</p>
            </div>
            <div className="scroll">
              {dayDrives.map(s => <DriveCard key={s.id} s={s} today={today} sel={sel} />)}
              {!dayDrives.length && (
                <div className="none">
                  <Icon n="calendar" s={20} />
                  <p>No drives on this day</p>
                  {sel >= today && <Link className="btn sm" href={sel === today ? '/new' : `/new?date=${sel}`}><Icon n="plus" s={14} />{sel === today ? 'New drive' : 'Plan a drive on this day'}</Link>}
                </div>
              )}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

// One drive in the day panel. Drives that need something done now carry a filled button for it.
function DriveCard({ s, today, sel }: { s: Summary; today: string; sel: string }) {
  const due = s.status === 'planned' && s.date <= today, now = due || s.status === 'live';
  const [pill, tone, go] = s.status === 'planned' ? [due ? 'Not set up' : 'Scheduled', due ? 'warn' : '', due ? 'Continue setting up' : 'Edit details']
    : s.status === 'live' ? (s.attendance ? ['In progress', 'ok', 'Open board'] : ['Attendance pending', 'warn', 'Take attendance'])
    : ['Completed', '', 'View drive'];
  const when = s.status === 'planned' ? (due ? 'Set up rounds, cabins and students to start' : 'Set up on the day')
    : s.status === 'live' ? `Started ${tm(s.startedAt)}` : `${tm(s.startedAt)} – ${tm(s.endedAt)}`;
  return (
    <Link href={due ? `/new?id=${s.id}` : `/drive/${s.id}`} className="dcard">
      <div className="dc-top"><b>{s.company}</b><span className={`pill ${tone}`}>{pill}</span></div>
      <div className="dc-meta">{[s.date !== sel && longDate(s.date), s.location, when].filter(Boolean).join(' · ')}</div>
      {s.status === 'live' && s.attendance && <div className="dc-stats"><span><b>{s.inCabin}</b> in cabins</span><span><b>{s.awaiting}</b> awaiting</span><span><b>{s.blrSelected}</b> BLR selected</span></div>}
      {s.status === 'done' && <div className="dc-stats"><span><b>{s.students}</b> students</span><span><b>{s.blrSelected}</b> BLR selected</span><span><b>{s.rejected}</b> rejected</span></div>}
      <span className={now ? 'btn sm primary' : 'dc-open'}>{go}<Icon n="right" s={14} /></span>
    </Link>
  );
}
