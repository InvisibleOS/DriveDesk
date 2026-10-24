// npm test — onboarding, CSV import, the call → finish → result flow, ending a drive, and old saves upgrading
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alsoIn, apply, placedIn, fits, migrate, upNext, newDrive, parseStudents, planDrive, roundOpen, statusLabel, summary, toTable, waiting, type Action, type DriveConfig } from '../lib/drive.ts';

const cfg = (over: Partial<DriveConfig> = {}): DriveConfig => ({
  company: 'Optum', date: '2026-10-23', location: 'J Block Interview Cabins', rounds: ['Tech', 'HR', 'Final'],
  rooms: [{ panel: 'Dr Rao', rounds: [0] }, { panel: '', rounds: [1, 2] }, { rounds: [] }],
  students: [{ name: 'Asha', campus: 'BLR' }, { name: 'Ben', campus: 'MPL' }, { name: ' asha ', campus: 'BLR' }, { name: '', campus: '' }],
  ...over,
});

test('onboarding builds a drive', () => {
  const d = newDrive(cfg(), 'x', 1000);
  assert.deepEqual(d.rooms.map(r => [r.name, r.panel, r.rounds]), [['Cabin 1', 'Dr Rao', [0]], ['Cabin 2', '', [1, 2]], ['Cabin 3', '', [0, 1, 2]]]);
  assert.deepEqual(d.students.map(s => [s.name, s.campus]), [['Asha', 'BLR'], ['Ben', 'MPL']], 'blank and duplicate names skipped');
  assert.deepEqual([d.status, d.location], ['live', 'J Block Interview Cabins']);
  assert.throws(() => newDrive(cfg({ company: ' ' }), 'x'), /company/);
  assert.throws(() => newDrive(cfg({ date: '23/10/2026' }), 'x'), /date/);
  assert.throws(() => newDrive(cfg({ rooms: [] }), 'x'), /cabin/);
  assert.throws(() => newDrive(cfg({ location: 'Library' }), 'x'), /location/);
});

test('student list keeps only registration number, name and campus', () => {
  const csv = '﻿Roll No,Student Name,Father Name,Campus,Email\n1,"Rao, Vihaan",X,MAHE Bengaluru,a@b\n2,Diya Patel,Y,Manipal,c@d\n3,Kabir,Z,,e@f';
  assert.deepEqual(parseStudents(toTable(csv)), [{ reg: '', name: 'Rao, Vihaan', campus: 'BLR' }, { reg: '', name: 'Diya Patel', campus: 'MPL' }, { reg: '', name: 'Kabir', campus: '' }], 'roll numbers that are not 9 digits are dropped');
  assert.deepEqual(parseStudents(toTable('First Name,Last Name,Location\nAsha,Rao,BLR')), [{ reg: '', name: 'Asha Rao', campus: 'BLR' }]);
  assert.deepEqual(parseStudents(toTable('Asha\tMPL\nBen\tBLR')), [{ reg: '', name: 'Asha', campus: 'MPL' }, { reg: '', name: 'Ben', campus: 'BLR' }], 'no header: campus column found by its values');
  assert.deepEqual(parseStudents(toTable('Registration Number,Student Name,Campus\n230905001,Asha,BLR\n230 905 002,Ben,Manipal')).map(r => r.reg), ['230905001', '230905002']);
  assert.deepEqual(parseStudents(toTable('230905001\tAsha\tMPL')), [{ reg: '230905001', name: 'Asha', campus: 'MPL' }], 'no header: registration column found by its values');
  assert.deepEqual(parseStudents(toTable('Nameet Shah\nRiya')).map(r => r.name), ['Nameet Shah', 'Riya'], 'a name containing "name" is not a header');
});

test('the registration number is the key', () => {
  const d = newDrive(cfg({ students: [{ reg: '230905001', name: 'Asha', campus: 'BLR' }, { reg: '230905002', name: 'Asha', campus: 'BLR' }] }), 'x');
  assert.equal(d.students.length, 2, 'same name, different numbers: two students');
  apply(d, { type: 'addStudents', rows: [{ reg: '230905001', name: 'Asha R', campus: 'BLR' }] });
  assert.equal(d.students.length, 2, 'same number: already on the list');
});

test('drive flow', () => {
  const d = newDrive(cfg(), 'x', 1000);
  const go = (a: Action) => apply(d, a, 1000 + d.log.length);
  assert.throws(() => go({ type: 'call', id: d.students[0].id, room: d.rooms[0].id }), /Take attendance first/);
  go({ type: 'attendance' });
  const st = (n: string) => d.students.find(s => s.name === n)!;
  const [a, b] = d.rooms;
  assert.ok(fits(a, st('Asha')) && !fits(b, st('Asha')), 'Cabin 1 takes round 1');
  assert.throws(() => go({ type: 'call', id: st('Asha').id, room: b.id }), /Cabin 2 doesn't take Tech/);

  go({ type: 'call', id: st('Asha').id, room: a.id });
  assert.equal(st('Asha').status, 'in');
  assert.throws(() => go({ type: 'call', id: st('Ben').id, room: a.id }), /not free/);
  assert.throws(() => go({ type: 'finish' }), /still in a cabin/);
  go({ type: 'out', id: st('Asha').id });
  assert.equal(st('Asha').status, 'pending');
  go({ type: 'move', id: st('Asha').id, to: 'waiting' });
  assert.ok(fits(b, st('Asha')), 'round 2 goes to Cabin 2');
  assert.equal(statusLabel(d, st('Asha')), 'Moved on to HR');

  go({ type: 'call', id: st('Ben').id, room: a.id });
  go({ type: 'out', id: st('Ben').id });
  go({ type: 'move', id: st('Ben').id, to: 'rejected' });
  assert.equal(statusLabel(d, st('Ben')), 'Rejected after Tech');

  go({ type: 'delRoom', room: d.rooms[2].id }); go({ type: 'addRoom' });
  assert.deepEqual(d.rooms.map(r => r.name), ['Cabin 1', 'Cabin 2', 'Cabin 3'], 'cabins stay numbered 1..n');
  go({ type: 'addRound' });
  assert.deepEqual(d.rooms.map(r => r.rounds.length), [1, 2, 4], 'only all-round cabins take the new round');
  assert.throws(() => go({ type: 'roomRounds', room: a.id, rounds: [] }), /at least one round/);
  go({ type: 'addStudents', rows: [{ name: 'Cara', campus: 'MPL' }] });
  assert.deepEqual(waiting(d).map(s => s.name), ['Asha', 'Cara']);

  go({ type: 'finish' });
  assert.equal(d.status, 'done');
  assert.ok(d.endedAt);
  assert.deepEqual([summary(d).students, summary(d).blr, summary(d).mpl, summary(d).rejected], [3, 1, 2, 1]);
  go({ type: 'reopen' });
  assert.equal(d.status, 'live');
});

test('a drive booked for a later day is set up on the day', () => {
  const d = planDrive({ company: 'Optum', date: '2026-10-30', location: 'AB5 near PCOM Office' }, 'p', 1000);
  assert.deepEqual([d.status, d.rooms.length, d.students.length], ['planned', 0, 0]);
  assert.throws(() => apply(d, { type: 'finish' }), /Set up this drive first/);
  apply(d, { type: 'date', date: '2026-10-31' });
  apply(d, { type: 'setup', config: cfg({ company: d.company, date: d.date }) }, 2000);
  assert.deepEqual([d.id, d.status, d.date, d.rooms.length, d.students.length, d.startedAt], ['p', 'live', '2026-10-31', 3, 2, 2000]);
  assert.equal(d.log[0].msg, 'Drive created for 2026-10-30', 'history kept');
  assert.throws(() => apply(d, { type: 'setup', config: cfg() }), /already set up/);
});

test('a round with every cabin busy cannot be called', () => {
  const d = newDrive(cfg({ rooms: [{ rounds: [0] }, { rounds: [1] }] }), 'x');
  assert.ok(roundOpen(d, 0));
  apply(d, { type: 'attendance' });
  apply(d, { type: 'call', id: d.students[0].id, room: d.rooms[0].id });
  assert.deepEqual([roundOpen(d, 0), roundOpen(d, 1), roundOpen(d, 2)], [false, true, false]);
});

test('attendance marks the missing students absent, once', () => {
  const d = newDrive(cfg(), 'x', 1000);
  const [asha, ben] = d.students;
  apply(d, { type: 'roll' });
  apply(d, { type: 'roll', id: asha.id, absent: true });
  apply(d, { type: 'roll', id: ben.id, absent: true });
  apply(d, { type: 'roll', id: ben.id, absent: true, reason: '  Medical  ' });
  apply(d, { type: 'roll', id: asha.id, absent: false });
  assert.deepEqual(d.roll, { [ben.id]: '  Medical  ' }, 'the list in progress is saved on the drive');
  apply(d, { type: 'attendance' }, 2000);
  assert.deepEqual([asha.status, ben.status, ben.reason, d.attendance, d.roll], ['waiting', 'absent', 'Medical', 2000, undefined]);
  assert.equal(d.log.at(-1)!.msg, 'Attendance taken: 1 present, 1 absent');
  assert.throws(() => apply(d, { type: 'attendance' }), /already/);
  assert.throws(() => apply(d, { type: 'roll', id: asha.id, absent: true }), /already/);
  apply(d, { type: 'reason', id: ben.id, reason: ' Train delayed ' });
  assert.equal(ben.reason, 'Train delayed', 'the reason can be written later');
  assert.throws(() => apply(d, { type: 'reason', id: asha.id, reason: 'x' }), /not marked absent/);
  apply(d, { type: 'move', id: ben.id, to: 'waiting' });
  assert.equal(ben.reason, undefined, 'marking present clears the reason');
});

test('call next: the first in each round, as many as it has free cabins', () => {
  const d = newDrive(cfg({ students: ['A', 'B', 'C', 'D'].map(name => ({ reg: '', name, campus: 'BLR' })) }), 'x', 0);
  const names = () => [...upNext(d)].map(id => d.students.find(s => s.id === id)!.name);
  assert.deepEqual(names(), ['A', 'B'], 'round 1 has two free cabins (Cabin 1 and the all-rounds Cabin 3)');
  apply(d, { type: 'attendance' }, 500);
  apply(d, { type: 'call', id: d.students[0].id, room: d.rooms[0].id }, 1000);
  assert.deepEqual(names(), ['B'], 'one free cabin left: only the top one');
  apply(d, { type: 'call', id: d.students[1].id, room: d.rooms[2].id }, 2000);
  assert.deepEqual(names(), [], 'no free cabin: nobody');
  apply(d, { type: 'out', id: d.students[0].id }, 3000);
  assert.deepEqual(names(), ['C'], 'a cabin frees up: the next one');
});

test('upgrades older saves', () => {
  const v1 = { company: 'K', rounds: ['R1', 'R2'], rooms: [{ id: '1', name: 'C', panel: '', round: 1, paused: true }], log: [{ t: new Date(2026, 9, 23, 15).getTime(), msg: 'x' }], seq: 1, auto: true, students: [
    { id: '1', name: 'Q', round: 1, status: 'queued', hist: [{ r: 0, res: 'next' }] },
    { id: '2', name: 'P', round: 1, status: 'pending', hist: [{ r: 1, res: 'later' }] },
  ] };
  const d = migrate(structuredClone(v1));
  assert.deepEqual(d.students.map(s => [s.status, s.done, s.hist[0].res, s.campus]), [['waiting', 1, 'done', ''], ['pending', 2, 'done', '']]);
  assert.deepEqual(d.rooms[0].rounds, [1]);
  assert.deepEqual([d.date, d.status, d.v, d.location, d.attendance], ['2026-10-23', 'live', 9, '', d.startedAt]);
  const v2 = { company: 'K', rounds: ['R1'], rooms: [], log: [], seq: 1, students: [
    { id: '1', name: 'Out', done: 1, status: 'waiting', hist: [{ r: 0, res: 'done' }] },
    { id: '2', name: 'New', done: 0, status: 'waiting', hist: [] },
  ] };
  assert.deepEqual(migrate(v2).students.map(s => s.status), ['pending', 'waiting']);
  const v4 = migrate({ v: 4, company: 'K', rounds: ['R1'], log: [], seq: 1, rooms: [{ id: '1', name: 'C', panel: '', round: null }], students: [{ id: '1', name: 'C', done: 0, status: 'called', hist: [{ r: 0, call: 5 }] }] });
  assert.deepEqual([v4.students[0].status, v4.students[0].hist[0].in, v4.rooms[0].rounds], ['in', 5, [0]]);
  assert.equal(migrate(v4), v4, 'current saves are left alone');
});

test('a student present in two live drives shows up in both', () => {
  const people = [{ reg: '111111111', name: 'Asha', campus: 'BLR' as const }, { reg: '222222222', name: 'Ben', campus: 'MPL' as const }, { reg: '333333333', name: 'Cara', campus: 'BLR' as const }];
  const optum = newDrive(cfg({ students: people }), 'optum', 0), kotak = newDrive(cfg({ company: 'Kotak', students: people.slice(0, 2) }), 'kotak', 0);
  const id = (d: typeof optum, n: string) => d.students.find(s => s.name === n)!.id;
  apply(optum, { type: 'attendance' }, 100);
  apply(kotak, { type: 'attendance' }, 100);
  apply(kotak, { type: 'call', id: id(kotak, 'Asha'), room: kotak.rooms[0].id }, 5000);
  const seen = alsoIn(optum, [optum, kotak]);
  assert.deepEqual(Object.keys(seen).sort(), [id(optum, 'Asha'), id(optum, 'Ben')].sort(), 'matched by registration number; Cara is only in Optum');
  assert.deepEqual(seen[id(optum, 'Asha')], [{ company: 'Kotak', status: 'In Cabin 1 for Tech', busy: true, at: 5000 }]);
  assert.equal(seen[id(optum, 'Ben')][0].status, 'Not interviewed yet');

  apply(kotak, { type: 'move', id: id(kotak, 'Ben'), to: 'absent' }, 6000);
  assert.ok(!alsoIn(optum, [kotak])[id(optum, 'Ben')], 'absent in the other drive: not counted');
  apply(optum, { type: 'move', id: id(optum, 'Asha'), to: 'absent' }, 6000);
  assert.ok(!alsoIn(optum, [kotak])[id(optum, 'Asha')], 'absent here: not counted');
  apply(optum, { type: 'move', id: id(optum, 'Asha'), to: 'waiting' }, 7000);
  apply(kotak, { type: 'out', id: id(kotak, 'Asha') }, 8000);
  apply(kotak, { type: 'finish' }, 9000);
  assert.deepEqual(alsoIn(optum, [kotak]), {}, 'an ended drive does not count');
});

test('students selected in an earlier drive are known as placed', () => {
  const people = [{ reg: '111111111', name: 'Asha', campus: 'BLR' as const }, { reg: '222222222', name: 'Ben', campus: 'MPL' as const }];
  const early = newDrive(cfg({ company: 'Infosys', date: '2026-10-20', rounds: ['Tech'], students: people }), 'a', 0);
  const later = newDrive(cfg({ company: 'Deloitte', date: '2026-10-22', rounds: ['Tech'], students: people }), 'b', 0);
  for (const d of [later, early]) {
    apply(d, { type: 'attendance' }, 1);
    const asha = d.students[0].id;
    apply(d, { type: 'call', id: asha, room: d.rooms[0].id }, 2);
    apply(d, { type: 'out', id: asha }, 3);
    apply(d, { type: 'move', id: asha, to: 'selected' }, 4);
  }
  assert.deepEqual(placedIn([later, early]), { '111111111': { company: 'Infosys', date: '2026-10-20' } }, 'the first offer counts; Ben was never selected');
});
