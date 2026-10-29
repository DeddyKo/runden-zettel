// Liest den öffentlichen Google-Kalender (iCal/ICS) des Spieletreffs und
// liefert die kommenden Termine. Wiederkehrende Termine (RRULE), Ausnahmen
// (EXDATE) und einzeln geänderte Termine (RECURRENCE-ID) werden berücksichtigt.

const ZONE = 'Europe/Berlin';

// ---------- Zeitzonen-Hilfen ----------

const formatterCache = new Map();
function partsFormatter(tz) {
	if (!formatterCache.has(tz)) {
		formatterCache.set(
			tz,
			new Intl.DateTimeFormat('en-US', {
				timeZone: tz,
				hourCycle: 'h23',
				year: 'numeric',
				month: '2-digit',
				day: '2-digit',
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit'
			})
		);
	}
	return formatterCache.get(tz);
}

/** Wanduhrzeit (Jahr, Monat, Tag …) einer Zeitzone für einen Zeitpunkt. */
export function wallClock(ms, tz = ZONE) {
	const p = {};
	for (const part of partsFormatter(tz).formatToParts(new Date(ms))) p[part.type] = part.value;
	return {
		y: Number(p.year),
		m: Number(p.month),
		d: Number(p.day),
		h: Number(p.hour) % 24,
		mi: Number(p.minute),
		s: Number(p.second)
	};
}

function offsetOf(ms, tz) {
	const w = wallClock(ms, tz);
	return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000;
}

/** Wanduhrzeit in einer Zeitzone → echter Zeitpunkt (ms). */
export function zonedToMs(c, tz) {
	const guess = Date.UTC(c.y, c.m - 1, c.d, c.h || 0, c.mi || 0, c.s || 0);
	if (!tz || tz === 'UTC') return guess;
	let result = guess - offsetOf(guess, tz);
	const second = guess - offsetOf(result, tz);
	if (second !== result) result = second;
	return result;
}

/** Datum (JJJJ-MM-TT) in Berlin für einen Zeitpunkt. */
export function berlinDate(ms) {
	const w = wallClock(ms, ZONE);
	return `${w.y}-${String(w.m).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
}

// ---------- ICS lesen ----------

function unfold(text) {
	return text
		.replace(/\r\n[ \t]/g, '')
		.replace(/\n[ \t]/g, '')
		.split(/\r\n|\n|\r/);
}

function unescapeText(v) {
	return v
		.replace(/\\n/gi, '\n')
		.replace(/\\,/g, ',')
		.replace(/\\;/g, ';')
		.replace(/\\\\/g, '\\');
}

function splitProp(line) {
	// Doppelpunkte in Parametern mit Anführungszeichen beachten
	let inQuote = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') inQuote = !inQuote;
		else if (ch === ':' && !inQuote) {
			const head = line.slice(0, i);
			const value = line.slice(i + 1);
			const [name, ...params] = head.split(';');
			const p = {};
			for (const param of params) {
				const eq = param.indexOf('=');
				if (eq > 0) p[param.slice(0, eq).toUpperCase()] = param.slice(eq + 1).replace(/^"|"$/g, '');
			}
			return { name: name.toUpperCase(), params: p, value };
		}
	}
	return null;
}

/** Liest einen ICS-Datumswert → { comps, tz, allDay } */
function parseDateValue(value, params) {
	const v = value.trim();
	const allDay = params.VALUE === 'DATE' || /^\d{8}$/.test(v);
	const comps = {
		y: Number(v.slice(0, 4)),
		m: Number(v.slice(4, 6)),
		d: Number(v.slice(6, 8)),
		h: allDay ? 0 : Number(v.slice(9, 11)),
		mi: allDay ? 0 : Number(v.slice(11, 13)),
		s: allDay ? 0 : Number(v.slice(13, 15) || 0)
	};
	if (allDay) return { comps, tz: ZONE, allDay: true };
	if (v.endsWith('Z')) {
		// UTC-Zeit → für Wiederholungen in Berliner Wanduhrzeit umrechnen
		const ms = Date.UTC(comps.y, comps.m - 1, comps.d, comps.h, comps.mi, comps.s);
		return { comps: wallClock(ms, ZONE), tz: ZONE, allDay: false };
	}
	return { comps, tz: params.TZID || ZONE, allDay: false };
}

function toMs(dv) {
	return zonedToMs(dv.comps, dv.tz);
}

function parseDuration(value) {
	const m = value.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
	if (!m) return 0;
	const [, sign, w, d, h, mi, s] = m;
	const total = ((((Number(w || 0) * 7 + Number(d || 0)) * 24 + Number(h || 0)) * 60 + Number(mi || 0)) * 60 + Number(s || 0)) * 1000;
	return sign === '-' ? -total : total;
}

export function parseIcs(text) {
	const events = [];
	let cur = null;
	for (const line of unfold(text)) {
		if (line === 'BEGIN:VEVENT') {
			cur = { exdates: [], rdates: [] };
			continue;
		}
		if (line === 'END:VEVENT') {
			if (cur && cur.start) events.push(cur);
			cur = null;
			continue;
		}
		if (!cur) continue;
		const prop = splitProp(line);
		if (!prop) continue;
		switch (prop.name) {
			case 'UID':
				cur.uid = prop.value.trim();
				break;
			case 'SUMMARY':
				cur.title = unescapeText(prop.value).trim();
				break;
			case 'LOCATION':
				cur.location = unescapeText(prop.value).trim();
				break;
			case 'STATUS':
				cur.status = prop.value.trim().toUpperCase();
				break;
			case 'DTSTART':
				cur.start = parseDateValue(prop.value, prop.params);
				break;
			case 'DTEND':
				cur.end = parseDateValue(prop.value, prop.params);
				break;
			case 'DURATION':
				cur.durationMs = parseDuration(prop.value.trim());
				break;
			case 'RRULE':
				cur.rrule = prop.value.trim();
				break;
			case 'EXDATE':
				for (const part of prop.value.split(',')) cur.exdates.push(toMs(parseDateValue(part, prop.params)));
				break;
			case 'RDATE':
				for (const part of prop.value.split(',')) cur.rdates.push(parseDateValue(part, prop.params));
				break;
			case 'RECURRENCE-ID':
				cur.recurrenceId = toMs(parseDateValue(prop.value, prop.params));
				break;
		}
	}
	return events;
}

// ---------- Wiederholungen ----------

const DAY_INDEX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseRule(rrule) {
	const r = {};
	for (const part of rrule.split(';')) {
		const [k, v] = part.split('=');
		if (k && v) r[k.toUpperCase()] = v;
	}
	return r;
}

function parseByDay(value) {
	if (!value) return [];
	return value
		.split(',')
		.map((t) => t.trim().match(/^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/))
		.filter(Boolean)
		.map((m) => ({ nth: m[1] ? Number(m[1]) : null, day: DAY_INDEX[m[2]] }));
}

// Kalenderdatum-Arithmetik auf Basis von UTC (nur Datum, keine Zeitzone)
const dayNum = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 86400000);
const fromDayNum = (n) => {
	const dt = new Date(n * 86400000);
	return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
};
const weekday = (n) => new Date(n * 86400000).getUTCDay();
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function nthWeekday(y, m, wd, nth) {
	const dim = daysInMonth(y, m);
	if (nth > 0) {
		const first = weekday(dayNum(y, m, 1));
		const day = 1 + ((wd - first + 7) % 7) + (nth - 1) * 7;
		return day <= dim ? day : null;
	}
	const last = weekday(dayNum(y, m, dim));
	const day = dim - ((last - wd + 7) % 7) + (nth + 1) * 7;
	return day >= 1 ? day : null;
}

/**
 * Liefert die Startzeitpunkte (ms) einer Serie bis `untilMs`.
 * Unterstützt FREQ=DAILY/WEEKLY/MONTHLY/YEARLY mit INTERVAL, COUNT, UNTIL,
 * BYDAY (auch 1FR, -1FR) und BYMONTHDAY.
 */
export function expandRule(ev, untilMs) {
	const rule = parseRule(ev.rrule);
	const freq = rule.FREQ;
	const interval = Math.max(1, Number(rule.INTERVAL || 1));
	const count = rule.COUNT ? Number(rule.COUNT) : Infinity;
	const until = rule.UNTIL ? toMs(parseDateValue(rule.UNTIL, {})) : Infinity;
	const byDay = parseByDay(rule.BYDAY);
	const byMonthDay = rule.BYMONTHDAY ? rule.BYMONTHDAY.split(',').map(Number) : [];
	const s = ev.start.comps;
	const startDay = dayNum(s.y, s.m, s.d);
	const startMs = toMs(ev.start);
	const limit = Math.min(untilMs, until);
	const out = [];
	let produced = 0;

	const emit = (dn) => {
		if (dn < startDay) return true;
		const c = fromDayNum(dn);
		const ms = zonedToMs({ ...c, h: s.h, mi: s.mi, s: s.s }, ev.start.tz);
		if (ms < startMs) return true;
		if (ms > limit || produced >= count) return false;
		produced++;
		out.push(ms);
		return true;
	};

	for (let step = 0; step < 5000; step++) {
		let days = [];
		if (freq === 'DAILY') {
			days = [startDay + step * interval];
		} else if (freq === 'WEEKLY') {
			const weekStart = startDay - ((weekday(startDay) + 6) % 7) + step * interval * 7; // Montag
			const wds = byDay.length ? byDay.map((b) => b.day) : [weekday(startDay)];
			days = wds.map((wd) => weekStart + ((wd + 6) % 7)).sort((a, b) => a - b);
		} else if (freq === 'MONTHLY') {
			const total = s.y * 12 + (s.m - 1) + step * interval;
			const y = Math.floor(total / 12);
			const m = (total % 12) + 1;
			const list = [];
			if (byDay.length) {
				for (const b of byDay) {
					if (b.nth) {
						const d = nthWeekday(y, m, b.day, b.nth);
						if (d) list.push(dayNum(y, m, d));
					} else {
						for (let d = 1; d <= daysInMonth(y, m); d++) if (weekday(dayNum(y, m, d)) === b.day) list.push(dayNum(y, m, d));
					}
				}
			} else {
				const mds = byMonthDay.length ? byMonthDay : [s.d];
				for (const md of mds) {
					const d = md > 0 ? md : daysInMonth(y, m) + md + 1;
					if (d >= 1 && d <= daysInMonth(y, m)) list.push(dayNum(y, m, d));
				}
			}
			days = list.sort((a, b) => a - b);
		} else if (freq === 'YEARLY') {
			const y = s.y + step * interval;
			if (s.d <= daysInMonth(y, s.m)) days = [dayNum(y, s.m, s.d)];
		} else {
			break;
		}
		let goOn = true;
		for (const dn of days) {
			if (!emit(dn)) {
				goOn = false;
				break;
			}
		}
		if (!goOn) break;
		// Sicherheitsabbruch: weit hinter dem Zeitfenster
		const lastDay = days.length ? days[days.length - 1] : startDay;
		if (lastDay * 86400000 > limit + 86400000 * 40) break;
	}
	return out;
}

// ---------- Termine berechnen ----------

/**
 * Kommende Termine ab Beginn des heutigen Tages (Berlin) für `tage` Tage.
 */
export function kommendeTermine(icsText, { jetzt = Date.now(), tage = 120 } = {}) {
	const heute = wallClock(jetzt, ZONE);
	const fromMs = zonedToMs({ y: heute.y, m: heute.m, d: heute.d, h: 0, mi: 0, s: 0 }, ZONE);
	const toMsLimit = fromMs + tage * 86400000;
	const events = parseIcs(icsText);

	const overrides = new Map(); // uid|ms → event
	for (const ev of events) if (ev.recurrenceId != null && ev.uid) overrides.set(`${ev.uid}|${ev.recurrenceId}`, ev);

	const result = [];
	const durationOf = (ev) => {
		if (ev.end) return toMs(ev.end) - toMs(ev.start);
		if (ev.durationMs) return ev.durationMs;
		return ev.start.allDay ? 86400000 : 0;
	};
	const push = (ev, startMs) => {
		const endMs = startMs + durationOf(ev);
		if (endMs < fromMs || startMs > toMsLimit) return;
		const title = ev.title || 'Spieleabend';
		result.push({
			datum: berlinDate(startMs),
			start: new Date(startMs).toISOString(),
			ende: new Date(endMs).toISOString(),
			ganztaegig: !!ev.start.allDay,
			titel: title.replace(/^\s*abgesagt\b[!?.:]?\s*/i, '').trim() || title,
			ort: (ev.location || '')
				.split(',')
				.map((p) => p.trim())
				.filter((p) => p && p.toLowerCase() !== 'deutschland')
				.join(', '),
			abgesagt: ev.status === 'CANCELLED' || /^\s*abgesagt\b/i.test(title)
		});
	};

	for (const ev of events) {
		if (ev.recurrenceId != null) continue; // werden über die Serie eingefügt
		if (ev.rrule || ev.rdates.length) {
			const starts = ev.rrule ? expandRule(ev, toMsLimit) : [toMs(ev.start)];
			for (const rd of ev.rdates) starts.push(toMs({ ...rd, tz: rd.tz }));
			for (const ms of starts) {
				if (ev.exdates.includes(ms)) continue;
				const ov = overrides.get(`${ev.uid}|${ms}`);
				if (ov) {
					overrides.delete(`${ev.uid}|${ms}`);
					if (ov.status !== 'CANCELLED') push({ ...ev, ...ov, exdates: [], rdates: [] }, toMs(ov.start));
					continue;
				}
				push(ev, ms);
			}
		} else if (ev.status !== 'CANCELLED') {
			push(ev, toMs(ev.start));
		}
	}
	// Einzeln geänderte Termine, deren Serie nicht (mehr) passt
	for (const ov of overrides.values()) if (ov.status !== 'CANCELLED') push(ov, toMs(ov.start));

	result.sort((a, b) => a.start.localeCompare(b.start));
	// doppelte (gleicher Start + Titel) entfernen
	return result.filter((e, i, arr) => i === 0 || !(arr[i - 1].start === e.start && arr[i - 1].titel === e.titel));
}
