'use client';
import { useParams } from 'next/navigation';
import { RoomCard } from '../../../../board';
import { Icon, useDrive, useNow } from '../../../../ui';

// One cabin on a volunteer's phone: who is inside and a big Exited button.
export default function Cabin() {
  const { id, room } = useParams<{ id: string; room: string }>();
  const { x, live, send, gate } = useDrive(id);
  const t = useNow();
  if (gate || !x) return gate;

  const r = x.drive.rooms.find(r => r.id === room);
  if (!r) return <div className="emptyst"><h2>Cabin not found</h2><p className="meta">It may have been removed. <a href={`/drive/${id}`}>Open the board</a></p></div>;
  return (
    <div className="cabin">
      <div className="toolbar"><a className="btn sm ghost" href={`/drive/${id}`}><Icon n="left" s={14} />{x.drive.company}</a><div className="sp" /><span className={`pill ${live ? 'ok live' : 'warn'}`}>{live ? 'Live' : 'Reconnecting…'}</span></div>
      <RoomCard d={x.drive} r={r} t={t} send={send} big />
    </div>
  );
}
