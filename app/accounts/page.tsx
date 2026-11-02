'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { Member, Role } from '@/lib/drive';
import { Av, DeskMenu, Icon, More, PageHead, TopBar, ask, letGo, loadPeople, post, toast, usePeople, withPin } from '../ui';

const ROLES: Record<Role, [string, string]> = {
  admin: ['Admin', 'Everything, including these accounts'],
  senior: ['Senior', 'Creates drives, approves volunteers, runs every drive'],
  junior: ['Junior', 'Sees every drive, volunteers, runs the ones they volunteer at'],
};
const ORDER: Role[] = ['admin', 'senior', 'junior'];
const seen = (t?: number | null) => t ? new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Never';
// a username from a name: the first name, lowercase letters and digits only
const suggest = (name: string) => (name.trim().split(/\s+/)[0] ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// The admin's Accounts page: everyone who can sign in, adding junior and senior members, a new password for someone who
// lost theirs, and removing someone. A new password is shown once, to copy and send; it is stored encrypted, so nobody
// can read it afterwards.
export default function Accounts() {
  const p = usePeople();
  const [list, setList] = useState<Member[] | null>(null);
  const [made, setMade] = useState<{ m: Pick<Member, 'name' | 'user'>; password: string; reset?: boolean } | null>(null);
  const add = useRef<HTMLDialogElement>(null);
  const load = () => fetch(withPin('/api/members?fresh=1')).then(async r => {
    if (r.status === 401) return void (location.href = '/'); // signed out: the dashboard shows the sign-in
    const j = await r.json();
    if (!r.ok) throw Error(j.error);
    setList(j.members);
    loadPeople(); // volunteer pickers elsewhere see the change too
  }).catch(e => toast(e.message === 'Failed to fetch' ? 'Server not reachable' : `Couldn’t load the accounts: ${e.message}`, true));
  useEffect(() => { load() }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (p && p.me?.role !== 'admin') return (
    <div className="app"><TopBar title="Accounts"><DeskMenu /></TopBar>
      <main><div className="emptyst"><div><h2>Only the admin account manages accounts</h2><p className="meta">Ask the placement coordinator to add someone or reset a password.</p></div>
        <div className="row"><Link className="btn" href="/"><Icon n="left" />All drives</Link></div></div></main>
    </div>
  );
  const reset = async (m: Member) => {
    if (!await ask(`New password for ${m.name}?`, 'Their current password stops working, and they are signed out on every laptop until they sign in with the new one.', 'Make a new password')) return;
    try { const { password } = await post<{ password: string }>('/api/members', { type: 'reset', id: m.id }); setMade({ m, password, reset: true }) } catch { /* already shown */ }
  };
  const remove = async (m: Member) => {
    if (!await ask(`Remove ${m.name}?`, 'They can’t sign in any more and their volunteer requests are dropped. Drives they helped with stay as they are.', 'Remove member', true)) return;
    try { await post('/api/members', { type: 'remove', id: m.id }); toast(`${m.name} removed`); load() } catch { /* already shown */ }
  };
  const rows = [...list ?? []].sort((a, b) => ORDER.indexOf(a.role) - ORDER.indexOf(b.role) || a.name.localeCompare(b.name));
  const count = (r: Role) => rows.filter(m => m.role === r).length;

  return (
    <div className="app">
      <TopBar title="Accounts"><DeskMenu /></TopBar>
      <main className="acc">
        <PageHead title="Accounts" meta={<p className="meta">Who can sign in to DriveDesk, and what each of them can do.</p>}>
          <button className="primary" onClick={() => { letGo(); add.current?.showModal() }}><Icon n="userPlus" />Add member</button>
        </PageHead>
        <div className="roles">{ORDER.map(r => (
          <div key={r} className={`role ${r}`}><b>{ROLES[r][0]}<span>{list ? count(r) : ''}</span></b><small>{ROLES[r][1]}</small></div>
        ))}</div>
        <div className="panel">
          <div className="scroll"><table>
            <thead><tr><th>Name</th><th>Username</th><th>Role</th><th className="hide-sm">Last signed in</th><th /></tr></thead>
            <tbody>
              {rows.map(m => (
                <tr key={m.user}>
                  <td><span className="member"><Av n={m.name} /><b>{m.name}</b>{m.user === p?.me?.user && <span className="tag">You</span>}</span></td>
                  <td className="reg">{m.user}</td>
                  <td><span className={`pill role-${m.role}`}>{ROLES[m.role][0]}</span></td>
                  <td className="meta hide-sm">{seen(m.seen)}</td>
                  <td className="act">{m.role !== 'admin' && <More className="icon sm ghost" label={`More for ${m.name}`} items={[
                    [<><Icon n="key" />New password</>, () => reset(m)],
                    [<><Icon n="trash" />Remove</>, () => remove(m)],
                  ]} />}</td>
                </tr>
              ))}
              {!list && <tr><td colSpan={5} className="empty">Loading…</td></tr>}
            </tbody>
          </table></div>
        </div>
      </main>
      <AddMember sheet={add} done={(m, password) => { setMade({ m, password }); load() }} />
      {made && <Login {...made} close={() => setMade(null)} />}
    </div>
  );
}

// Adding a member: their name, a username (suggested from the first name) and whether they are junior or senior.
function AddMember({ sheet, done }: { sheet: React.RefObject<HTMLDialogElement | null>; done: (m: Pick<Member, 'name' | 'user'>, password: string) => void }) {
  const [name, setName] = useState(''), [user, setUser] = useState(''), [typed, setTyped] = useState(false);
  const [role, setRole] = useState<Role>('junior'), [busy, setBusy] = useState(false);
  const clear = () => { setName(''); setUser(''); setTyped(false); setRole('junior') };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { password } = await post<{ password: string }>('/api/members', { type: 'add', name: name.trim(), user, role });
      sheet.current?.close();
      done({ name: name.trim(), user }, password);
    } catch { /* already shown */ }
    setBusy(false);
  };
  return (
    <dialog ref={sheet} className="ask acc-add" onClose={clear}>
      <form onSubmit={submit}>
        <h3>Add a member</h3>
        <label className="field">Full name<input required autoFocus maxLength={80} value={name} placeholder="e.g. Riddhi Jain"
          onChange={e => { setName(e.target.value); if (!typed) setUser(suggest(e.target.value)) }} /></label>
        <label className="field">Username<input required value={user} pattern="[a-z0-9][a-z0-9._\-]{1,31}" maxLength={32} autoCapitalize="none" spellCheck={false}
          title="2 to 32 lowercase letters, numbers, dots or dashes" onChange={e => { setUser(e.target.value.toLowerCase()); setTyped(true) }} />
          <small className="meta">What they type to sign in.</small></label>
        <div className="field">Role
          <div className="seg" role="radiogroup" aria-label="Role">
            {(['junior', 'senior'] as Role[]).map(r => <button type="button" key={r} role="radio" aria-checked={role === r} className={role === r ? 'on' : ''} onClick={() => setRole(r)}>{ROLES[r][0]}</button>)}
          </div>
          <small className="meta">{ROLES[role][1]}.</small>
        </div>
        <div className="row"><div className="sp" /><button type="button" onClick={() => sheet.current?.close()}>Cancel</button>
          <button className="primary" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button></div>
      </form>
    </dialog>
  );
}

// A member's login, shown once after adding them or making a new password, with a button that copies it to send on.
function Login({ m, password, reset, close }: { m: Pick<Member, 'name' | 'user'>; password: string; reset?: boolean; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { letGo(); ref.current?.showModal() }, []);
  const first = m.name.split(/\s+/)[0];
  const copy = () => navigator.clipboard.writeText(`DriveDesk login for ${m.name}\nUsername: ${m.user}\nPassword: ${password}`)
    .then(() => toast('Login copied'), () => toast('Couldn’t copy. Select the password and copy it by hand', true));
  return (
    <dialog ref={ref} className="ask login" onClose={close}>
      <span className="okmark"><Icon n={reset ? 'key' : 'check'} s={20} /></span>
      <h3>{reset ? `New password for ${m.name}` : `${m.name} can sign in now`}</h3>
      <dl className="creds">
        <div><dt>Username</dt><dd>{m.user}</dd></div>
        <div><dt>Password</dt><dd>{password}</dd></div>
      </dl>
      <p>Send these to {first}. The password isn&rsquo;t shown again; if it&rsquo;s lost, make a new one here.</p>
      <form method="dialog" className="row"><button type="button" onClick={copy}><Icon n="copy" />Copy login</button><div className="sp" /><button className="primary">Done</button></form>
    </dialog>
  );
}
