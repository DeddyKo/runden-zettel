import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kommendeTermine } from '../lib/kalender.js';

const ics = (...events) =>
	['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.flatMap((e) => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');

const JETZT = Date.parse('2026-10-29T10:00:00Z');

test('14-tägig freitags 18 Uhr, über die Zeitumstellung', () => {
	const t = kommendeTermine(
		ics([
			'UID:serie1',
			'SUMMARY:Spieleabend',
			'LOCATION:Ev. Gemeindehaus Brochterbeck\\, Dorfstraße 34\\, 49545 Tecklenburg\\, Deutschland',
			'DTSTART;TZID=Europe/Berlin:20260904T180000',
			'DTEND;TZID=Europe/Berlin:20260904T230000',
			'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=FR'
		]),
		{ jetzt: JETZT, tage: 40 }
	);
	assert.deepEqual(
		t.map((x) => x.datum),
		['2026-10-30', '2026-11-13', '2026-11-27']
	);
	// 18:00 Winterzeit = 17:00 UTC
	assert.equal(t[0].start, '2026-10-30T17:00:00.000Z');
	assert.equal(t[0].ort, 'Ev. Gemeindehaus Brochterbeck, Dorfstraße 34, 49545 Tecklenburg');
	assert.equal(t[0].abgesagt, false);
});

test('Sommerzeit: 18 Uhr = 16 Uhr UTC', () => {
	const t = kommendeTermine(
		ics(['UID:a', 'SUMMARY:Sommer', 'DTSTART;TZID=Europe/Berlin:20260918T180000', 'DTEND;TZID=Europe/Berlin:20260918T220000']),
		{ jetzt: Date.parse('2026-09-01T10:00:00Z') }
	);
	assert.equal(t[0].start, '2026-09-18T16:00:00.000Z');
});

test('EXDATE fällt weg, RECURRENCE-ID mit „Abgesagt“ wird als abgesagt markiert', () => {
	const t = kommendeTermine(
		ics(
			[
				'UID:serie2',
				'SUMMARY:Spieleabend',
				'DTSTART;TZID=Europe/Berlin:20261030T180000',
				'DTEND;TZID=Europe/Berlin:20261030T230000',
				'RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=5',
				'EXDATE;TZID=Europe/Berlin:20261113T180000'
			],
			[
				'UID:serie2',
				'RECURRENCE-ID;TZID=Europe/Berlin:20261127T180000',
				'SUMMARY:Abgesagt: Spieleabend',
				'DTSTART;TZID=Europe/Berlin:20261127T180000',
				'DTEND;TZID=Europe/Berlin:20261127T230000'
			],
			[
				'UID:serie2',
				'RECURRENCE-ID;TZID=Europe/Berlin:20261211T180000',
				'SUMMARY:Spieleabend (Fabi)',
				'LOCATION:Fabi Ibbenbüren',
				'DTSTART;TZID=Europe/Berlin:20261211T190000',
				'DTEND;TZID=Europe/Berlin:20261211T230000'
			]
		),
		{ jetzt: JETZT, tage: 120 }
	);
	assert.deepEqual(
		t.map((x) => [x.datum, x.abgesagt, x.titel]),
		[
			['2026-10-30', false, 'Spieleabend'],
			['2026-11-27', true, 'Spieleabend'],
			['2026-12-11', false, 'Spieleabend (Fabi)'],
			['2026-12-25', false, 'Spieleabend']
		]
	);
	assert.equal(t[2].start, '2026-12-11T18:00:00.000Z');
	assert.equal(t[2].ort, 'Fabi Ibbenbüren');
});

test('Monatlich am 1. und 3. Freitag', () => {
	const t = kommendeTermine(
		ics(['UID:m', 'SUMMARY:Treff', 'DTSTART;TZID=Europe/Berlin:20260102T180000', 'DTEND;TZID=Europe/Berlin:20260102T230000', 'RRULE:FREQ=MONTHLY;BYDAY=1FR,3FR']),
		{ jetzt: JETZT, tage: 40 }
	);
	assert.deepEqual(
		t.map((x) => x.datum),
		['2026-11-06', '2026-11-20', '2026-12-04']
	);
});

test('UTC-Zeiten, UNTIL und abgesagte Einzeltermine', () => {
	const t = kommendeTermine(
		ics(
			['UID:u', 'SUMMARY:UTC-Serie', 'DTSTART:20261030T170000Z', 'DTEND:20261030T220000Z', 'RRULE:FREQ=WEEKLY;UNTIL=20261107T000000Z'],
			['UID:c', 'SUMMARY:Gestrichen', 'STATUS:CANCELLED', 'DTSTART;TZID=Europe/Berlin:20261101T180000'],
			['UID:g', 'SUMMARY:Ganztags', 'DTSTART;VALUE=DATE:20261102', 'DTEND;VALUE=DATE:20261103']
		),
		{ jetzt: JETZT, tage: 30 }
	);
	assert.deepEqual(
		t.map((x) => x.titel + ' ' + x.datum),
		['UTC-Serie 2026-10-30', 'Ganztags 2026-11-02', 'UTC-Serie 2026-11-06']
	);
	assert.equal(t[0].start, '2026-10-30T17:00:00.000Z');
});

test('Vergangenes wird ausgeblendet, heutiger Abend bleibt sichtbar', () => {
	const t = kommendeTermine(
		ics(
			['UID:alt', 'SUMMARY:Alt', 'DTSTART;TZID=Europe/Berlin:20261016T180000', 'DTEND;TZID=Europe/Berlin:20261016T230000'],
			['UID:heute', 'SUMMARY:Heute', 'DTSTART;TZID=Europe/Berlin:20261029T180000', 'DTEND;TZID=Europe/Berlin:20261029T230000']
		),
		{ jetzt: Date.parse('2026-10-29T21:30:00Z') }
	);
	assert.deepEqual(t.map((x) => x.titel), ['Heute']);
});
