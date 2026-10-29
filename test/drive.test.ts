// npm test — onboarding, CSV import, the call → finish → result flow, ending a drive, and old saves upgrading
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { absentAt, alsoIn, apply, missed, unlisted, forecast, fits, migrate, upNext, newDrive, parseStudents, planDrive, roundOpen, statusLabel, summary, toTable, lead, refuse, runs, phaseStates, eligible, waiting, placedAll, titleOf, phasesOf, prevOf, fromPrev, type Action, type DriveConfig } from '../lib/drive.ts';

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

test('a configured drive keeps its phases in order and is set up for interviews on the day', () => {
  const plan = { kind: 'P' as const, phases: [{ k: 'int' as const, venue: 'J Block Interview Cabins', at: '2026-11-03T10:00', crew: [] },
    { k: 'ppt' as const, venue: 'AB4 Auditorium', at: '2026-11-01T09:00', crew: ['riddhi', 'riddhi', 'Riddhi Jain', 'shivansh'] }, { k: 'int' as const, venue: '', at: '2026-11-09T10:00', crew: [] }], students: [{ reg: '', name: 'Asha', campus: 'BLR' as const }] };
  const d = planDrive({ company: 'Optum', plan }, 'p', 1000);
  assert.deepEqual(d.phases!.map(p => p.k), ['ppt', 'int'], 'fixed order, each phase once');
  assert.deepEqual([d.status, d.date, d.location, d.kind], ['planned', '2026-11-03', 'J Block Interview Cabins', 'P'], 'on the calendar on interview day');
  assert.deepEqual(d.phases![0].crew, ['riddhi', 'shivansh'], 'each volunteer once per phase, by username; names from before accounts dropped');
  assert.deepEqual([lead({ user: 'pcom', name: 'PCOM', role: 'admin' }), lead({ user: 's', name: 'S', role: 'senior' }), lead({ user: 'r', name: 'R', role: 'junior' }), lead(null)], [true, true, false, false]);
  // a junior runs only the phases they volunteer at
  const riddhi = { user: 'riddhi', name: 'Riddhi Jain', role: 'junior' as const }, tanvi = { user: 'tanvi', name: 'Tanvi Ghule', role: 'junior' as const };
  const ph = d.phases!, moved = (k: string, p: object) => ({ type: 'plan' as const, plan: { kind: 'P' as const, phases: ph.map(x => x.k === k ? { ...x, ...p } : x) } });
  assert.deepEqual([runs(d, riddhi), runs(d, tanvi), runs(d, { ...tanvi, role: 'senior' })], [{ ppt: true, int: false }, { ppt: false, int: false }, { ppt: true, int: true }]);
  assert.equal(refuse(d, riddhi, { type: 'phaseRoll', k: 'ppt' }), '', 'her own phase');
  assert.match(refuse(d, riddhi, { type: 'attendance' }), /interviews' volunteers/, 'not the interviews');
  assert.match(refuse(d, tanvi, { type: 'phaseRoll', k: 'ppt' }), /PPT's volunteers/, 'not a phase she does not volunteer at');
  assert.equal(refuse(d, riddhi, moved('ppt', { venue: 'AB5 Auditorium' })), '', 'moves her own phase');
  assert.match(refuse(d, riddhi, moved('int', { at: '2026-11-04T10:00' })), /interviews' volunteers/);
  assert.match(refuse(d, riddhi, moved('ppt', { crew: ['riddhi', 'tanvi'] })), /who volunteers/);
  assert.match(refuse(d, riddhi, { type: 'plan', plan: { kind: 'P', phases: [ph[1]] } }), /add or remove phases/);
  assert.equal(refuse(d, { ...tanvi, role: 'senior' }, { type: 'attendance' }), '', 'seniors run every phase');
  assert.throws(() => planDrive({ company: 'Optum', plan: { ...plan, kind: 'X' as never } }, 'p'), /type/);
  assert.throws(() => planDrive({ company: 'Optum', plan: { ...plan, phases: [{ k: 'oa', venue: '', at: '', crew: [] }] } }, 'p'), /date and time of the OA/);
  assert.throws(() => planDrive({ company: 'Optum', plan: { ...plan, phases: [plan.phases[0], { ...plan.phases[1], at: '2026-11-03T10:00' }] } }, 'p'), /interviews has to be after the PPT/, 'same time is not after');
  assert.throws(() => apply(planDrive({ company: 'Optum', plan }, 'q'), { type: 'plan', plan: { ...plan, phases: [plan.phases[1], { k: 'oa', venue: '', at: '2026-10-31T10:00', crew: [] }, plan.phases[0]] } }), /OA has to be after the PPT/);
  apply(d, { type: 'plan', plan: { ...plan, phases: [{ k: 'oa', venue: 'Virtual', at: '2026-11-02', crew: [] }, ...d.phases!] } });
  assert.deepEqual(d.phases!.map(p => p.k), ['ppt', 'oa', 'int'], 'a phase added later goes in its place');
  apply(d, { type: 'plan', plan: { kind: 'I', phases: d.phases! } });
  assert.equal(d.kind, 'P', 'the type of offer is fixed once the drive is created');
  apply(d, { type: 'setup', config: cfg({ company: 'Renamed', date: '2026-11-03' }) }, 2000);
  assert.deepEqual([d.status, d.phases!.length, d.kind, d.company], ['live', 3, 'P', 'Optum'], 'setting up the interviews keeps the plan');
  assert.throws(() => apply(d, { type: 'plan', plan: { ...plan, phases: d.phases!.filter(p => p.k !== 'oa') } }), /OA has begun, so it stays/, 'the interviews began, so the phases before them are over');
  const e = planDrive({ company: 'Optum', plan }, 'e');
  apply(e, { type: 'plan', plan: { ...plan, phases: [plan.phases[0]] } }, 0);
  assert.deepEqual(e.phases!.map(p => p.k), ['int'], 'a phase that has not begun can be removed');
});

test('a phase goes live at its start time and is done once it ends or the next one begins', () => {
  const at = (s: string) => Date.parse(s);
  const d = planDrive({ company: 'Optum', plan: { kind: 'P', phases: [{ k: 'ppt', venue: '', at: '2026-11-01T10:00', crew: [] }, { k: 'oa', venue: '', at: '2026-11-02T14:00', crew: [] }, { k: 'int', venue: '', at: '2026-11-04T09:30', crew: [] }], students: [{ reg: '', name: 'Asha', campus: 'BLR' }] } }, 'p');
  assert.deepEqual(phaseStates(d, at('2026-10-30T12:00')), ['Upcoming', 'Upcoming', 'Upcoming']);
  assert.deepEqual(phaseStates(d, at('2026-11-01T09:59')), ['Today', 'Upcoming', 'Upcoming']);
  assert.deepEqual(phaseStates(d, at('2026-11-01T10:00')), ['Live', 'Upcoming', 'Upcoming'], 'live at its start time');
  assert.deepEqual(phaseStates(d, at('2026-11-01T11:59')), ['Live', 'Upcoming', 'Upcoming']);
  assert.deepEqual(phaseStates(d, at('2026-11-01T12:00')), ['Done', 'Upcoming', 'Upcoming'], 'a talk ends two hours after it starts');
  assert.deepEqual(phaseStates(d, at('2026-11-02T08:00')), ['Done', 'Today', 'Upcoming']);
  assert.deepEqual(phaseStates(d, at('2026-11-02T14:00')), ['Done', 'Live', 'Upcoming'], 'an OA goes live at its time too');
  assert.throws(() => apply(d, { type: 'phaseRoll', k: 'oa' }, at('2026-11-01T11:00')), /Choose who takes the OA first/, 'its students are chosen first');
  apply(d, { type: 'shortlist', k: 'oa', regs: null });
  assert.throws(() => apply(d, { type: 'phaseRoll', k: 'oa' }, at('2026-11-01T11:00')), /End the PPT first/, 'not while the PPT runs');
  apply(d, { type: 'phaseRoll', k: 'oa' }, at('2026-11-02T13:00'));
  assert.deepEqual(phaseStates(d, at('2026-11-02T13:01')), ['Done', 'Today', 'Upcoming'], 'its attendance can be taken early, but it is live only from its time');
  assert.throws(() => apply(d, { type: 'endPhase', k: 'oa' }, at('2026-11-02T13:30')), /hasn't started yet/, 'and it can be ended only once live');
  assert.deepEqual(phaseStates(d, at('2026-11-02T14:00')), ['Done', 'Live', 'Upcoming']);
  assert.deepEqual(phaseStates(d, at('2026-11-04T10:00')), ['Done', 'Live', 'Today'], 'an OA stays live until it is ended');
  apply(d, { type: 'endPhase', k: 'oa' }, at('2026-11-04T09:00'));
  apply(d, { type: 'setup', config: cfg({ company: 'Optum', date: '2026-11-04' }) });
  assert.deepEqual(phaseStates(d, at('2026-11-04T10:00')), ['Done', 'Done', 'Today'], 'set up, nobody called yet');
  apply(d, { type: 'attendance' }, at('2026-11-04T10:00'));
  apply(d, { type: 'call', id: d.students[0].id, room: d.rooms[0].id }, at('2026-11-04T10:05'));
  assert.deepEqual(phaseStates(d, at('2026-11-04T10:06')), ['Done', 'Done', 'Live'], 'live with the first student called');
  assert.equal(d.startedAt, at('2026-11-04T10:05'));
  apply(d, { type: 'out', id: d.students[0].id });
  apply(d, { type: 'finish' });
  assert.deepEqual(phaseStates(d, at('2026-11-04T18:00')), ['Done', 'Done', 'Done']);
});

test('only students present at the earlier phases go on, unless made eligible', () => {
  const at = (s: string) => Date.parse(s);
  const plan = { kind: 'P' as const, phases: [{ k: 'ppt' as const, venue: '', at: '2026-11-01T10:00', crew: [] }, { k: 'oa' as const, venue: '', at: '2026-11-02T14:00', crew: [] }, { k: 'int' as const, venue: '', at: '2026-11-04T09:30', crew: [] }],
    students: [{ reg: '', name: 'Asha', campus: 'BLR' as const }, { reg: '', name: 'Ben', campus: 'MPL' as const }, { reg: '', name: 'Cy', campus: 'BLR' as const }, { reg: '', name: ' asha ', campus: 'BLR' as const }] };
  assert.throws(() => planDrive({ company: 'Optum', plan: { ...plan, students: [] } }, 'p'), /list of students/);
  const d = planDrive({ company: 'Optum', plan }, 'p'), [, b, c] = d.pool!;
  const online0 = planDrive({ company: 'Optum', plan: { ...plan, phases: [plan.phases[2]] } }, 'q');
  assert.equal(d.pool!.length, 3, 'the same student twice is kept once');
  assert.throws(() => apply(d, { type: 'phaseRoll', k: 'ppt' }, at('2026-11-01T09:00')), /hasn't started/);
  assert.throws(() => apply(d, { type: 'endPhase', k: 'ppt' }, at('2026-11-01T10:01')), /Take attendance before ending the PPT/, 'in person, attendance is required');
  apply(d, { type: 'phaseRoll', k: 'ppt' }, at('2026-11-01T10:05'));
  apply(d, { type: 'phaseRoll', k: 'ppt', id: b.id, absent: true, reason: 'Unwell' }, at('2026-11-01T10:06'));
  apply(d, { type: 'phaseRoll', k: 'ppt', id: c.id, absent: true }, at('2026-11-01T10:07'));
  apply(d, { type: 'endPhase', k: 'ppt' }, at('2026-11-01T11:00'));
  assert.throws(() => apply(d, { type: 'phaseRoll', k: 'ppt', id: c.id }, at('2026-11-01T11:01')), /PPT has ended/, 'attendance is final once it ends');
  apply(d, { type: 'reason', k: 'ppt', id: c.id, reason: ' Clash with exam ' }, at('2026-11-03T09:00'));
  assert.equal(d.phases![0].roll![c.id], 'Clash with exam', 'a reason can be given after it ends');
  assert.throws(() => apply(d, { type: 'reason', k: 'ppt', id: d.pool![0].id, reason: 'x' }), /Only students absent/);
  assert.deepEqual(eligible(d, 'oa').map(s => s.name), ['Asha']);
  apply(d, { type: 'excuse', k: 'ppt', id: c.id });
  assert.deepEqual(eligible(d, 'oa').map(s => s.name), ['Asha', 'Cy'], 'made eligible');
  apply(d, { type: 'shortlist', k: 'oa', regs: null });
  assert.throws(() => apply(d, { type: 'phaseRoll', k: 'oa', id: b.id, absent: true }, at('2026-11-02T14:10')), /Student not found/, 'not eligible, not on the roll');
  apply(d, { type: 'phaseRoll', k: 'oa', id: c.id, absent: true }, at('2026-11-02T14:10'));
  apply(d, { type: 'phaseRoll', k: 'oa', id: c.id, reason: 'late' }, at('2026-11-02T19:00')); apply(d, { type: 'phaseRoll', k: 'oa', id: c.id, absent: true }, at('2026-11-02T19:01'));
  apply(d, { type: 'endPhase', k: 'oa' }, at('2026-11-02T19:30'));
  assert.throws(() => apply(d, { type: 'phaseRoll', k: 'oa', id: c.id }, at('2026-11-02T19:31')), /OA has ended/, 'an OA runs until it is ended, however long');
  apply(d, { type: 'setup', config: cfg({ company: 'Optum', date: '2026-11-04' }) });
  assert.deepEqual(d.students.map(s => s.name), ['Asha'], 'the interviews take the students still eligible');
  assert.equal(d.attendance, undefined, 'their own roll call, of those present at the earlier phases');
  assert.deepEqual(missed(d).map(m => [m.s.name, m.k]), [['Ben', 'ppt'], ['Cy', 'oa']], 'absent at the PPT or OA, and where');
  apply(d, { type: 'attendance' });
  apply(d, { type: 'call', id: d.students[0].id, room: d.rooms[0].id });
  apply(d, { type: 'excuse', k: 'oa', id: c.id });
  assert.deepEqual(d.students.map(s => s.name), ['Asha', 'Cy'], 'made eligible once the interviews are set up: joins them');
  apply(online0, { type: 'plan', plan: { ...plan, phases: [plan.phases[1], plan.phases[2]] } }, at('2026-11-04T09:29'));
  const online = planDrive({ company: 'Optum', plan: { ...plan, phases: [{ ...plan.phases[0], venue: ' virtual ' }] } }, 'o');
  apply(online, { type: 'endPhase', k: 'ppt' }, at('2026-11-01T10:30'));
  assert.equal(eligible(online, 'int').length, 3, 'a virtual PPT can end without attendance: everyone stays eligible');
  const solo = planDrive({ company: 'Optum', plan: { kind: 'P', phases: [plan.phases[2]], students: plan.students } }, 's');
  apply(solo, { type: 'setup', config: cfg() });
  assert.equal(solo.attendance, undefined, 'interviews with nothing before them still take attendance');
});

test('any round can be removed before anyone reaches it; the cabins follow', () => {
  const d = newDrive(cfg({ rooms: [{ rounds: [0, 2] }, { rounds: [1] }, { rounds: [0, 1, 2] }] }), 'x');
  apply(d, { type: 'delRound', i: 1 });
  assert.deepEqual([d.rounds, d.rooms.map(r => r.rounds)], [['Tech', 'Final'], [[0, 1], [0, 1], [0, 1]]], 'Final moves up; a cabin left with none takes every round');
  apply(d, { type: 'attendance' }); apply(d, { type: 'call', id: d.students[0].id, room: d.rooms[0].id });
  assert.throws(() => apply(d, { type: 'delRound', i: 0 }), /already reached/);
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
  assert.equal(absentAt(d, ben), 'Interview attendance');
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
  assert.deepEqual([d.date, d.status, d.v, d.location, d.attendance], ['2026-10-23', 'live', 10, '', d.startedAt]);
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

test('wait and finish estimates follow the average interview and the free cabins', () => {
  const d = newDrive(cfg({ students: ['A', 'B', 'C', 'D'].map(name => ({ reg: '', name, campus: 'BLR' })) }), 'x', 0);
  const [a, b, c, dd] = d.students, min = 60_000;
  apply(d, { type: 'attendance' }, 1);
  assert.equal(forecast(d, 1), null, 'no estimate before the first interview has finished');
  apply(d, { type: 'call', id: a.id, room: d.rooms[0].id }, 0);
  apply(d, { type: 'out', id: a.id }, 10 * min);
  apply(d, { type: 'move', id: a.id, to: 'waiting' }, 10 * min);
  const f = forecast(d, 10 * min)!;
  // round 1 takes 10 min; Cabin 1 and Cabin 3 take it, Cabin 2 takes rounds 2 and 3
  assert.deepEqual([b, c, dd, a].map(s => f.wait[s.id] / min), [0, 0, 10, 0], 'B and C go now, D when a round-1 cabin frees up, A to Cabin 2');
  assert.ok(f.done >= 20 * min, 'not done before D finishes');
});

test('one result for several: only those still awaiting one', () => {
  const d = newDrive(cfg({ students: [{ name: 'A', campus: 'BLR' }, { name: 'B', campus: 'BLR' }, { name: 'C', campus: 'MPL' }] }), 'x');
  apply(d, { type: 'attendance' });
  const [a, b, c] = d.students;
  for (const s of [a, b, c]) { apply(d, { type: 'call', id: s.id, room: d.rooms[0].id }); apply(d, { type: 'out', id: s.id }) }
  apply(d, { type: 'move', id: a.id, to: 'rejected' });
  apply(d, { type: 'results', ids: [a.id, b.id], pass: true });
  apply(d, { type: 'results', ids: [c.id], pass: false });
  assert.deepEqual([a, b, c].map(s => s.status), ['rejected', 'waiting', 'rejected']);
  // ⋯ › Unreject on the Rejected list: back to awaiting the same round's result, in their place (since leaving the cabin)
  apply(d, { type: 'unreject', id: a.id }, Date.now() + 60000);
  assert.deepEqual([a.status, a.done, a.t], ['pending', 1, a.hist[0].out]);
  assert.throws(() => apply(d, { type: 'unreject', id: b.id }), /not rejected/);
  apply(d, { type: 'results', ids: [a.id], pass: true });
  assert.deepEqual([a.status, a.done], ['waiting', 1]);
});

test('interviews-only: attendance before their time, live with the first call, and they stay once begun', () => {
  const at = (s: string) => Date.parse(s);
  const d = planDrive({ company: 'Optum', plan: { kind: 'P', phases: [{ k: 'int', venue: '', at: '2026-11-04T09:30', crew: [] }], students: [{ reg: '', name: 'Asha', campus: 'BLR' }, { reg: '', name: 'Ben', campus: 'MPL' }] } }, 'q');
  const ppt = { k: 'ppt' as const, venue: '', at: '2026-11-03T10:00', crew: [] };
  assert.throws(() => apply(d, { type: 'attendance' }), /Set up/, 'starting them needs their attendance opened');
  apply(d, { type: 'plan', plan: { kind: 'P', phases: [ppt, ...d.phases!] } }, at('2026-11-05T10:00'));
  assert.equal(d.phases!.length, 2, 'past their set time, phases can still be added');
  apply(d, { type: 'plan', plan: { kind: 'P', phases: d.phases!.slice(1) } }, at('2026-11-02T10:00'));
  assert.throws(() => apply(d, { type: 'start' }, at('2026-11-04T08:30')), /Choose who takes the interviews first/);
  apply(d, { type: 'shortlist', k: 'int', regs: null });
  apply(d, { type: 'start' }, at('2026-11-04T08:30'));
  assert.throws(() => apply(d, { type: 'plan', plan: { kind: 'P', phases: [ppt, ...d.phases!] } }), /no more phases/, 'not once their attendance has opened');
  apply(d, { type: 'attendance' }, at('2026-11-04T08:35'));
  assert.throws(() => apply(d, { type: 'call', id: d.students[0].id, room: 'none' }), 'confirmed without cabins: no one can be called yet');
  apply(d, { type: 'addRoom' }, at('2026-11-04T08:36'));
  assert.deepEqual(phaseStates(d, at('2026-11-04T08:45')), ['Today'], 'attendance taken early: not live yet');
  apply(d, { type: 'call', id: d.students[0].id, room: d.rooms[0].id }, at('2026-11-04T09:00'));
  assert.deepEqual(phaseStates(d, at('2026-11-04T09:01')), ['Live']);
  apply(d, { type: 'move', id: d.students[1].id, to: 'absent' }, at('2026-11-04T09:10'));
  assert.equal(absentAt(d, d.students[1]), 'Round 1', 'missed when due for a round');
  assert.equal(d.startedAt, at('2026-11-04T09:00'));
});

test('placed: the list from before DriveDesk first, then each drive\'s selections, earliest offer counts', () => {
  const at = (date: string, company: string, reg: string, status: 'selected' | 'rejected') => {
    const d = newDrive(cfg({ company, date, students: [{ reg, name: `S${reg}`, campus: 'BLR' }] }), company);
    d.students[0].status = status;
    return d;
  };
  const sheet = [{ reg: '230905001', name: 'Asha', campus: 'BLR' as const, company: 'Infosys', date: '' }];
  const p = placedAll(sheet, [at('2026-11-02', 'Later', '230905002', 'selected'), at('2026-10-20', 'Earlier', '230905002', 'selected'),
    at('2026-10-21', 'Optum', '230905001', 'selected'), at('2026-10-22', 'Kotak', '230905003', 'rejected')]);
  assert.deepEqual(p.map(x => [x.reg, x.company]), [['230905001', 'Infosys'], ['230905002', 'Earlier']]);
  assert.equal(p[1].drive, 'Earlier');
});

test('several OAs, names, shortlists, and phases side by side', () => {
  const at = (s: string) => Date.parse(s), ph = (k: 'ppt' | 'oa' | 'int', t: string, x = {}) => ({ id: '', k, venue: '', at: t, crew: [], ...x });
  const students = ['230905001', '230905002', '230905003', '230905004'].map((reg, i) => ({ reg, name: `S${i}`, campus: 'BLR' as const }));
  const d = planDrive({ company: 'Opus', plan: { kind: 'P', students, phases: [ph('ppt', '2026-11-01T10:00'), ph('oa', '2026-11-02T10:00'),
    ph('oa', '2026-11-02T10:00', { name: 'Coding round' }), ph('int', '2026-11-02T09:00')] } }, 'opus');
  assert.deepEqual(phasesOf(d).map(p => [p.id, titleOf(d, p)]), [['ppt', 'Pre-placement talk'], ['oa', 'Online assessment 1'], ['oa2', 'Coding round'], ['int', 'Interviews']],
    'ids for each OA; the OAs and interviews may share or swap times, only the talk comes first');
  assert.throws(() => planDrive({ company: 'X', plan: { kind: 'P', students, phases: [ph('ppt', '2026-11-03T10:00'), ph('oa', '2026-11-02T10:00')] } }, 'x'), /OA has to be after the PPT/);
  const [a, b, c, e] = d.pool!;
  apply(d, { type: 'phaseRoll', k: 'ppt' }, at('2026-11-01T10:05'));
  apply(d, { type: 'phaseRoll', k: 'ppt', id: e.id, absent: true }, at('2026-11-01T10:06'));
  apply(d, { type: 'endPhase', k: 'ppt' }, at('2026-11-01T11:00'));
  assert.equal(apply(d, { type: 'shortlist', k: 'oa', regs: ['230905001', '230905004', '999999999'] }), '2 students shortlisted for the OA 1');
  assert.deepEqual(eligible(d, 'oa').map(s => s.name), ['S0'], 'only the shortlisted, and never anyone absent at the PPT');
  apply(d, { type: 'shortlist', k: 'oa2', regs: null });
  assert.deepEqual(eligible(d, 'oa2').map(s => s.name), ['S0', 'S1', 'S2'], 'at the same time as the OA 1: from the PPT, so everyone present at it');
  apply(d, { type: 'shortlist', k: 'oa2', regs: ['230905002'] });
  apply(d, { type: 'shortlist', k: 'int', regs: ['230905003'] });
  assert.deepEqual(['oa', 'oa2', 'int'].map(k => eligible(d, k).map(s => s.name)), [['S0'], ['S1'], ['S2']], 'each its own shortlist, side by side');
  apply(d, { type: 'phaseRoll', k: 'oa' }, at('2026-11-02T10:01'));
  apply(d, { type: 'phaseRoll', k: 'oa2' }, at('2026-11-02T10:01'));
  assert.deepEqual(phaseStates(d, at('2026-11-02T10:30')), ['Done', 'Live', 'Live', 'Today'], 'both OAs live at once');
  assert.throws(() => apply(d, { type: 'shortlist', k: 'oa', regs: ['230905002'] }), /has begun/, 'fixed once its attendance starts');
  apply(d, { type: 'setup', config: cfg({ company: 'Opus', date: '2026-11-02' }) });
  assert.deepEqual(d.students.map(s => s.name), ['S2'], 'the interviews take their own shortlist, whatever the OAs did');
  assert.deepEqual(unlisted(d).map(s => s.name), ['S0', 'S1'], 'not eligible: off the shortlist, but not absent at the PPT');
  apply(d, { type: 'addStudents', rows: [b] });
  assert.deepEqual([d.students.map(s => s.name), unlisted(d).map(s => s.name)], [['S2', 'S1'], ['S0']], 'made eligible, they join the interviews');
  void [a, b, c];
});

test('seniors edit a drive\'s name and type of offer', () => {
  const d = newDrive(cfg(), 'x');
  apply(d, { type: 'details', company: ' Optum Global ', kind: 'I' });
  assert.deepEqual([d.company, d.kind], ['Optum Global', 'I']);
  assert.throws(() => apply(d, { type: 'details', company: ' ', kind: 'I' }), /company name/);
  assert.match(refuse(d, { user: 'riddhi', name: 'Riddhi', role: 'junior' }, { type: 'details', company: 'X', kind: 'P' }), /senior members/);
});

test('"from the previous phase" follows the times: phases at the same time run alongside', () => {
  const ph = (k: 'ppt' | 'oa' | 'int', t: string) => ({ id: '', k, venue: '', at: t, crew: [] });
  const students = ['230905001', '230905002', '230905003'].map((reg, i) => ({ reg, name: `S${i}`, campus: 'BLR' as const }));
  const d = planDrive({ company: 'Opus', plan: { kind: 'P', students, phases: [ph('ppt', '2026-11-01T10:00'), ph('oa', '2026-11-02T11:00'), ph('oa', '2026-11-02T11:00'), ph('int', '2026-11-03T10:00')] } }, 'o');
  assert.deepEqual([1, 2, 3].map(i => prevOf(d, i)), [0, 0, 2], 'both OAs at 11:00 take from the PPT; the interviews from the latest OA before them');
  apply(d, { type: 'phaseRoll', k: 'ppt' }, Date.parse('2026-11-01T10:05'));
  apply(d, { type: 'phaseRoll', k: 'ppt', id: d.pool![2].id, absent: true }, Date.parse('2026-11-01T10:06'));
  apply(d, { type: 'endPhase', k: 'ppt' }, Date.parse('2026-11-01T11:00'));
  apply(d, { type: 'shortlist', k: 'oa2', regs: null });
  assert.equal(fromPrev(d, d.phases![2]), 'those present at the PPT');
  assert.deepEqual(eligible(d, 'oa2').map(s => s.name), ['S0', 'S1'], 'everyone present at the PPT');
  apply(d, { type: 'shortlist', k: 'oa', regs: null });
  apply(d, { type: 'phaseRoll', k: 'oa' }, Date.parse('2026-11-02T10:00'));
  apply(d, { type: 'phaseRoll', k: 'oa2' }, Date.parse('2026-11-02T10:00')); // doesn't wait for the OA 1
});
