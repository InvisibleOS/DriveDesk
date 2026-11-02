'use client';
import Link from 'next/link';
import { useState } from 'react';
import { lead, localDate, type Ask, type Member, type Summary } from '@/lib/drive';
import { PICON } from './phases';
import { DeskMenu, Icon, PageHead, Stat, TopBar, longDate, tm, useDrives } from './ui';

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// 6 weeks × 7 days covering the month ('YYYY-MM'), Monday first
function monthDays(month: string) {
  const [y, m] = month.split('-').map(Number), lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => localDate(new Date(y, m - 1, 1 - lead + i).getTime()));
}
const shift = (month: string, by: number) => { const [y, m] = month.split('-').map(Number); return localDate(new Date(y, m - 1 + by, 1).getTime()).slice(0, 7) };
// a drive's phases each sit on their own day: the calendar and the day panel list phases, not drives.
// mine: the signed-in member volunteers at it ('on') or has asked to ('asked')
type Entry = { s: Summary; p: Summary['phases'][number]; day: string; mine?: 'on' | 'asked' };
const monthName = (month: string) => new Date(`${month}-01T00:00`).toLocaleDateString([], { month: 'long', year: 'numeric' });

// Everyone sees every drive; seniors create them. A junior's own phases are marked, and their numbers are only the
// drives still to come and the phases they volunteer at that are still ahead.
export default function Dashboard() {
  const { list, me, asks, gate } = useDrives();
  const today = localDate(Date.now());
  const [sel, setSel] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  if (gate || !list) return gate;

  const all: Entry[] = list.flatMap(s => s.phases.map(p => ({ s, p, day: p.at.slice(0, 10), mine: mineOf(s, p, me, asks) }))).sort((a, b) => a.p.at.localeCompare(b.p.at));
  const boss = lead(me), ahead = all.filter(e => e.mine === 'on' && e.p.state !== 'Done').length;
  const byDate = new Map<string, Entry[]>();
  for (const e of all) byDate.set(e.day, [...(byDate.get(e.day) ?? []), e]);
  const live = list.filter(s => s.status === 'live');
  const coming = list.filter(s => s.status !== 'done').length; // planned or running
  const inMonth = list.filter(s => s.phases.some(p => p.at.startsWith(month)));
  const total = (k: 'students' | 'blrSelected') => inMonth.reduce((a, s) => a + s[k], 0);
  // today also lists phases from earlier days that are still open (running, or never ended), so they are one click away
  const earlier = sel === today ? all.filter(e => e.day < today && e.p.state !== 'Done') : [];
  const dayDrives = [...earlier, ...(byDate.get(sel) ?? [])];
  const pick = (day: string) => { setSel(day); setMonth(day.slice(0, 7)) };

  return (
    <div className="app">
      <TopBar>
        <Link className="btn" href="/placed"><Icon n="award" />Placed students</Link>
        {boss && <Link className="btn primary" href="/create"><Icon n="plus" />New drive</Link>}
        <DeskMenu />
      </TopBar>
      <main className="dash">
        <PageHead title="Drives" meta={<p className="meta">{longDate(today)} · {live.length ? `${live.length} in progress` : 'No drive running right now'}</p>}>
          <div className="stats">
            {boss ? <>
              <Stat label={`Drives in ${monthName(month).split(' ')[0]}`} value={inMonth.length} sub={`${inMonth.filter(s => s.status === 'live').length} in progress`} />
              <Stat label="Students" value={total('students')} />
              <Stat label="BLR selected" value={total('blrSelected')} tone="ok" sub="this month" />
              <Stat label="All drives" value={list.length} sub="since you started" />
            </> : <>{/* a junior: only what volunteering needs */}
              <Stat label="Upcoming drives" value={coming} sub={live.length ? `${live.length} in progress` : undefined} />
              <Stat label="Volunteering" value={ahead} sub={`phase${ahead === 1 ? '' : 's'} ahead`} tone={ahead ? 'mine' : ''} />
            </>}
          </div>
        </PageHead>

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
                    onClick={() => pick(day)} aria-label={`${longDate(day)}: ${ds.length} phase${ds.length === 1 ? '' : 's'}`} aria-pressed={day === sel}>
                    <span className="dh"><span className="dn">{+day.slice(8)}</span>{ds.length > 2 && <span className="more">+{ds.length - 2} more</span>}</span>
                    {ds.slice(0, 2).map(e => <span key={e.s.id + e.p.id} className={`chip ${tone(e)}${e.mine === 'on' ? ' mine' : ''}`} title={`${e.s.company} · ${e.p.name}${e.mine === 'on' ? ' · you volunteer' : ''}`}>{e.s.company} · {e.p.short[0].toUpperCase() + e.p.short.slice(1)}</span>)}
                  </button>
                );
              })}
            </div>
          </section>

          <aside className="card dayp">
            <div className="dayp-h">
              <h2>{sel === today ? 'Today' : longDate(sel)}</h2>
              <p className="meta">{sel === today && `${longDate(today)} · `}{dayDrives.length ? `${dayDrives.length} phase${dayDrives.length > 1 ? 's' : ''}` : 'Nothing scheduled'}</p>
            </div>
            <div className="scroll">
              {GROUPS.map(([g, l]) => {
                const es = dayDrives.filter(e => group(e) === g);
                return es.length > 0 && <div key={g} className="dgroup"><h3 className="sect-t">{l}<span>{es.length}</span></h3>{es.map(e => <DriveCard key={e.s.id + e.p.id} e={e} sel={sel} run={boss || e.mine === 'on'} />)}</div>;
              })}
              {!dayDrives.length && (
                <div className="none">
                  <Icon n="calendar" s={20} />
                  <p>No drives on this day</p>
                  {boss && sel >= today && <Link className="btn sm" href={sel === today ? '/create' : `/create?date=${sel}`}><Icon n="plus" s={14} />{sel === today ? 'New drive' : 'Plan a drive on this day'}</Link>}
                </div>
              )}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

const mineOf = (s: Summary, p: Summary['phases'][number], me: Member | null, asks: Ask[]): Entry['mine'] =>
  !me ? undefined : p.crew.includes(me.user) ? 'on' : asks.some(a => a.drive === s.id && a.k === p.id && a.user === me.user && a.status === 'pending') ? 'asked' : undefined;
const tone = ({ p }: Entry) => p.state === 'Live' ? 'live' : p.state === 'Done' ? 'done' : 'planned';
// the day panel, in what-to-do-first order: running now (or left open from an earlier day), still to come, finished
const GROUPS = [['now', 'Now'], ['next', 'Coming up'], ['done', 'Done']] as const;
const group = ({ s, p }: Entry) => p.state === 'Live' || (p.k === 'int' && s.status === 'live') ? 'now' : p.state === 'Done' ? 'done' : 'next';

// One phase of a drive in the day panel. Phases that need something done now carry a filled button for it
// (run: the signed-in member runs the drive; anyone else only views it).
function DriveCard({ e: { s, p, day, mine }, sel, run }: { e: Entry; sel: string; run: boolean }) {
  const int = p.k === 'int', due = p.state === 'Today' || p.state === 'Live';
  const [pill, tn] = p.state === 'Done' ? ['Done', ''] : p.state === 'Live' ? ['In progress', 'ok live']
    : int && s.status === 'live' ? ['Attendance open', 'warn'] : p.state === 'Today' ? ['Today', 'warn'] : ['Scheduled', ''];
  const when = int && s.status === 'done' ? `${tm(s.startedAt)} – ${tm(s.endedAt)}` : p.at.slice(11, 16);
  return (
    <Link href={`/drive/${s.id}`} className={`dcard ${group({ s, p, day })}`}>
      <span className="dc-ico"><Icon n={PICON[p.k]} s={16} /></span>
      <div className="dc-main">
        <div className="dc-top"><b>{s.company}</b><span className={`pill ${tn}`}>{pill}</span></div>
        <div className="dc-meta">{[p.name, day !== sel && longDate(day), when, p.venue].filter(Boolean).join(' · ')}</div>
        {mine && <span className={`tag ${mine}`}>{mine === 'on' ? 'You volunteer' : 'Requested'}</span>}
        {int && s.status === 'live' && s.attendance && <div className="dc-stats"><span><b>{s.inCabin}</b> in cabins</span><span><b>{s.awaiting}</b> awaiting</span><span className="ok"><b>{s.blrSelected}</b> BLR selected</span></div>}
        {int && s.status === 'done' && <div className="dc-stats"><span><b>{s.students}</b> students</span><span className="ok"><b>{s.blrSelected}</b> BLR selected</span><span><b>{s.rejected}</b> rejected</span></div>}
        {due && <span className="btn sm primary">{run && int && s.status === 'live' && s.attendance ? 'Open board' : 'View drive'}<Icon n="right" s={14} /></span>}
      </div>
      {!due && <span className="dc-go"><Icon n="next" s={16} /></span>}
    </Link>
  );
}
