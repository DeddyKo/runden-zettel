// Runden-Zettel – Server-Teil (Cloudflare Pages Functions + D1)
// Alle Anfragen an /api/... landen hier.

import { kommendeTermine, berlinDate } from '../../lib/kalender.js';

// Öffentlicher Google-Kalender des Spieletreffs (derselbe, den die Spieletreff-Website nutzt).
// Kann in Cloudflare über die Umgebungsvariable KALENDER_URL überschrieben werden.
const STANDARD_KALENDER =
	'https://calendar.google.com/calendar/ical/' +
	encodeURIComponent('5d1d857bdfe446b6f66f5a77351958678182bac29942538a178a113dd8e7a7fb@group.calendar.google.com') +
	'/public/basic.ics';

const GRENZEN = {
	spiel: 80,
	name: 30,
	kommentar: 200,
	link: 300,
	uhrzeit: 10,
	tischeProAbend: 40,
	eintraegeProTisch: 30,
	minPlaetze: 2,
	maxPlaetze: 12
};

// ---------- Hilfen ----------

const json = (daten, status = 200, extra = {}) =>
	new Response(JSON.stringify(daten), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra }
	});

const fehler = (text, status = 400) => json({ fehler: text }, status);

class Abbruch extends Error {
	constructor(text, status = 400) {
		super(text);
		this.status = status;
	}
}

function text(wert, max, pflicht = false, feld = 'Feld') {
	const t = String(wert ?? '')
		.replace(/[\u0000-\u001f\u007f]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (pflicht && !t) throw new Abbruch(`${feld} fehlt.`);
	if (t.length > max) throw new Abbruch(`${feld} ist zu lang (höchstens ${max} Zeichen).`);
	return t;
}

function linkPruefen(wert) {
	let t = text(wert, GRENZEN.link, false, 'Link');
	if (!t) return '';
	if (!/^https?:\/\//i.test(t)) t = 'https://' + t;
	try {
		const u = new URL(t);
		if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error();
		return u.toString();
	} catch {
		throw new Abbruch('Der Link sieht nicht wie eine Webadresse aus.');
	}
}

const gleich = (a, b) => String(a).trim().toLocaleLowerCase('de') === String(b).trim().toLocaleLowerCase('de');

function neueId() {
	const b = new Uint8Array(9);
	crypto.getRandomValues(b);
	return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function geraetKennung(request) {
	const k = request.headers.get('x-rz-geraet') || '';
	if (!/^[a-zA-Z0-9-]{20,64}$/.test(k)) throw new Abbruch('Gerätekennung fehlt. Bitte Seite neu laden.');
	return k;
}

async function koerper(request) {
	try {
		const d = await request.json();
		return d && typeof d === 'object' ? d : {};
	} catch {
		throw new Abbruch('Ungültige Anfrage.');
	}
}

function heute() {
	return berlinDate(Date.now());
}

function abendPruefen(abend) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(String(abend || ''))) throw new Abbruch('Abend fehlt.');
	const h = heute();
	if (abend < h) throw new Abbruch('Dieser Abend ist schon vorbei.');
	const max = berlinDate(Date.now() + 180 * 86400000);
	if (abend > max) throw new Abbruch('Dieser Abend liegt zu weit in der Zukunft.');
	return abend;
}

// ---------- Datenbank ----------

let schemaFertig = false;
let letzteBereinigung = 0;

async function vorbereiten(db) {
	if (!schemaFertig) {
		await db.batch([
			db.prepare(`CREATE TABLE IF NOT EXISTS tische (
				id TEXT PRIMARY KEY,
				abend TEXT NOT NULL,
				art TEXT NOT NULL,
				spiel TEXT NOT NULL,
				gastgeber TEXT NOT NULL,
				gastgeber_geraet TEXT NOT NULL,
				plaetze INTEGER NOT NULL DEFAULT 0,
				uhrzeit TEXT NOT NULL DEFAULT '',
				link TEXT NOT NULL DEFAULT '',
				kommentar TEXT NOT NULL DEFAULT '',
				erstellt INTEGER NOT NULL
			)`),
			db.prepare(`CREATE TABLE IF NOT EXISTS eintraege (
				id TEXT PRIMARY KEY,
				tisch_id TEXT NOT NULL,
				name TEXT NOT NULL,
				kommentar TEXT NOT NULL DEFAULT '',
				freund_von TEXT NOT NULL DEFAULT '',
				geraet TEXT NOT NULL,
				status TEXT NOT NULL,
				erstellt INTEGER NOT NULL
			)`),
			db.prepare('CREATE INDEX IF NOT EXISTS idx_tische_abend ON tische(abend)'),
			db.prepare('CREATE INDEX IF NOT EXISTS idx_eintraege_tisch ON eintraege(tisch_id)')
		]);
		schemaFertig = true;
	}
	// Alte Abende automatisch löschen (höchstens einmal pro Stunde prüfen)
	if (Date.now() - letzteBereinigung > 3600000) {
		const h = heute();
		await db.batch([
			db.prepare('DELETE FROM eintraege WHERE tisch_id IN (SELECT id FROM tische WHERE abend < ?)').bind(h),
			db.prepare('DELETE FROM tische WHERE abend < ?').bind(h)
		]);
		letzteBereinigung = Date.now();
	}
}

async function tischLaden(db, id) {
	const t = await db.prepare('SELECT * FROM tische WHERE id = ?').bind(id).first();
	if (!t) throw new Abbruch('Diesen Tisch gibt es nicht mehr.', 404);
	if (t.abend < heute()) throw new Abbruch('Dieser Abend ist schon vorbei.');
	return t;
}

async function eintraegeLaden(db, tischId) {
	const { results } = await db
		.prepare('SELECT * FROM eintraege WHERE tisch_id = ? ORDER BY erstellt, rowid')
		.bind(tischId)
		.all();
	return results || [];
}

function tischAusgeben(t, eintraege, geraet) {
	return {
		id: t.id,
		abend: t.abend,
		art: t.art,
		spiel: t.spiel,
		gastgeber: t.gastgeber,
		plaetze: t.plaetze,
		uhrzeit: t.uhrzeit,
		link: t.link,
		kommentar: t.kommentar,
		meins: t.gastgeber_geraet === geraet,
		eintraege: eintraege.map((e) => ({
			id: e.id,
			name: e.name,
			kommentar: e.kommentar,
			freundVon: e.freund_von,
			status: e.status,
			meins: e.geraet === geraet,
			entfernbar: e.geraet === geraet || t.gastgeber_geraet === geraet
		}))
	};
}

// ---------- Kalender (mit Zwischenspeicher) ----------

let kalenderCache = { zeit: 0, daten: null };

async function termineHolen(env) {
	if (kalenderCache.daten && Date.now() - kalenderCache.zeit < 15 * 60000) return kalenderCache.daten;
	const url = env.KALENDER_URL || STANDARD_KALENDER;
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), 8000);
	try {
		const r = await fetch(url, { signal: ctrl.signal, cf: { cacheTtl: 900 } });
		if (!r.ok) throw new Error('Kalender antwortet mit ' + r.status);
		const daten = kommendeTermine(await r.text(), { tage: 120 });
		kalenderCache = { zeit: Date.now(), daten };
		return daten;
	} finally {
		clearTimeout(timer);
	}
}

// ---------- Aktionen ----------

async function tischeListe(db, url, geraet) {
	const abend = abendPruefen(url.searchParams.get('abend'));
	const { results: tische } = await db
		.prepare('SELECT * FROM tische WHERE abend = ? ORDER BY erstellt, rowid')
		.bind(abend)
		.all();
	const ids = (tische || []).map((t) => t.id);
	let alle = [];
	if (ids.length) {
		const { results } = await db
			.prepare(`SELECT * FROM eintraege WHERE tisch_id IN (${ids.map(() => '?').join(',')}) ORDER BY erstellt, rowid`)
			.bind(...ids)
			.all();
		alle = results || [];
	}
	return json({
		abend,
		tische: (tische || []).map((t) =>
			tischAusgeben(
				t,
				alle.filter((e) => e.tisch_id === t.id),
				geraet
			)
		)
	});
}

async function tischAnlegen(db, request, geraet) {
	const d = await koerper(request);
	const abend = abendPruefen(d.abend);
	const art = d.art === 'lust' ? 'lust' : 'tisch';
	const spiel = text(d.spiel, GRENZEN.spiel, true, 'Spiel');
	const gastgeber = text(d.gastgeber, GRENZEN.name, true, 'Dein Vorname');
	const kommentar = text(d.kommentar, GRENZEN.kommentar, false, 'Kommentar');
	let plaetze = 0;
	let uhrzeit = '';
	let link = '';
	let freunde = [];
	if (art === 'tisch') {
		plaetze = Math.round(Number(d.plaetze));
		if (!(plaetze >= GRENZEN.minPlaetze && plaetze <= GRENZEN.maxPlaetze))
			throw new Abbruch(`Spielerzahl muss zwischen ${GRENZEN.minPlaetze} und ${GRENZEN.maxPlaetze} liegen.`);
		uhrzeit = text(d.uhrzeit, GRENZEN.uhrzeit, false, 'Startzeit');
		link = linkPruefen(d.link);
		freunde = (Array.isArray(d.freunde) ? d.freunde : [])
			.map((f) => text(f, GRENZEN.name, false, 'Name'))
			.filter(Boolean);
		const namen = [gastgeber, ...freunde];
		if (namen.some((n, i) => namen.findIndex((m) => gleich(m, n)) !== i)) throw new Abbruch('Ein Name steht doppelt drin.');
		if (namen.length > plaetze) throw new Abbruch('Mehr Namen als Plätze.');
	}
	const anzahl = await db.prepare('SELECT COUNT(*) AS n FROM tische WHERE abend = ?').bind(abend).first();
	if (anzahl && anzahl.n >= GRENZEN.tischeProAbend) throw new Abbruch('Für diesen Abend gibt es schon sehr viele Einträge.');

	const id = neueId();
	const jetzt = Date.now();
	const befehle = [
		db
			.prepare(
				'INSERT INTO tische (id, abend, art, spiel, gastgeber, gastgeber_geraet, plaetze, uhrzeit, link, kommentar, erstellt) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
			)
			.bind(id, abend, art, spiel, gastgeber, geraet, plaetze, uhrzeit, link, kommentar, jetzt),
		db
			.prepare('INSERT INTO eintraege (id, tisch_id, name, kommentar, freund_von, geraet, status, erstellt) VALUES (?,?,?,?,?,?,?,?)')
			.bind(neueId(), id, gastgeber, '', '', geraet, art === 'lust' ? 'lust' : 'dabei', jetzt)
	];
	freunde.forEach((f, i) =>
		befehle.push(
			db
				.prepare('INSERT INTO eintraege (id, tisch_id, name, kommentar, freund_von, geraet, status, erstellt) VALUES (?,?,?,?,?,?,?,?)')
				.bind(neueId(), id, f, '', gastgeber, geraet, 'dabei', jetzt + i + 1)
		)
	);
	await db.batch(befehle);
	const t = await tischLaden(db, id);
	return json({ tisch: tischAusgeben(t, await eintraegeLaden(db, id), geraet) }, 201);
}

async function eintragen(db, request, geraet, tischId) {
	const t = await tischLaden(db, tischId);
	const d = await koerper(request);
	const name = text(d.name, GRENZEN.name, true, 'Dein Vorname');
	const kommentar = text(d.kommentar, GRENZEN.kommentar, false, 'Kommentar');
	const eintraege = await eintraegeLaden(db, t.id);
	if (eintraege.some((e) => gleich(e.name, name))) throw new Abbruch(`${name} steht hier schon drin.`);
	if (eintraege.length >= GRENZEN.eintraegeProTisch) throw new Abbruch('Hier stehen schon sehr viele Namen.');

	const id = neueId();
	const jetzt = Date.now();
	let status;
	if (t.art === 'lust') status = 'lust';
	else status = d.modus === 'warteliste' ? 'warte' : 'dabei';

	if (status === 'dabei') {
		// Nur eintragen, wenn wirklich noch ein Platz frei ist (sicher gegen gleichzeitige Klicks)
		const r = await db
			.prepare(
				`INSERT INTO eintraege (id, tisch_id, name, kommentar, freund_von, geraet, status, erstellt)
				 SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM eintraege WHERE tisch_id = ? AND status = 'dabei') < ?`
			)
			.bind(id, t.id, name, kommentar, '', geraet, 'dabei', jetzt, t.id, t.plaetze)
			.run();
		if (!r.meta || !r.meta.changes) throw new Abbruch('Gerade ist der letzte Platz weggegangen. Du kannst dich auf die Warteliste setzen.', 409);
	} else {
		await db
			.prepare('INSERT INTO eintraege (id, tisch_id, name, kommentar, freund_von, geraet, status, erstellt) VALUES (?,?,?,?,?,?,?,?)')
			.bind(id, t.id, name, kommentar, '', geraet, status, jetzt)
			.run();
	}
	return json({ tisch: tischAusgeben(t, await eintraegeLaden(db, t.id), geraet) }, 201);
}

async function austragen(db, geraet, eintragId) {
	const e = await db.prepare('SELECT * FROM eintraege WHERE id = ?').bind(eintragId).first();
	if (!e) throw new Abbruch('Diesen Eintrag gibt es nicht mehr.', 404);
	const t = await tischLaden(db, e.tisch_id);
	if (e.geraet !== geraet && t.gastgeber_geraet !== geraet) throw new Abbruch('Du kannst nur deine eigenen Einträge entfernen.', 403);
	await db.prepare('DELETE FROM eintraege WHERE id = ?').bind(e.id).run();
	let nachgerueckt = '';
	if (t.art === 'tisch' && e.status === 'dabei') {
		const naechster = await db
			.prepare("SELECT * FROM eintraege WHERE tisch_id = ? AND status = 'warte' ORDER BY erstellt, rowid LIMIT 1")
			.bind(t.id)
			.first();
		if (naechster) {
			await db.prepare("UPDATE eintraege SET status = 'dabei' WHERE id = ?").bind(naechster.id).run();
			nachgerueckt = naechster.name;
		}
	}
	return json({ nachgerueckt, tisch: tischAusgeben(t, await eintraegeLaden(db, t.id), geraet) });
}

async function mitbringen(db, request, geraet, tischId) {
	const t = await tischLaden(db, tischId);
	if (t.art !== 'lust') throw new Abbruch('Dieser Tisch steht schon.');
	const eintraege = await eintraegeLaden(db, t.id);
	const ich = eintraege.find((e) => e.geraet === geraet);
	if (!ich) throw new Abbruch('Trag dich zuerst als interessiert ein.');
	const d = await koerper(request);
	let plaetze = Math.round(Number(d.plaetze || 0));
	if (!(plaetze >= GRENZEN.minPlaetze && plaetze <= GRENZEN.maxPlaetze)) plaetze = Math.min(GRENZEN.maxPlaetze, Math.max(4, eintraege.length));
	const befehle = [
		db.prepare("UPDATE tische SET art = 'tisch', gastgeber = ?, gastgeber_geraet = ?, plaetze = ? WHERE id = ?").bind(ich.name, geraet, plaetze, t.id)
	];
	// Bringer zuerst, dann die anderen in ihrer Reihenfolge; wer keinen Platz bekommt, kommt auf die Warteliste
	const reihenfolge = [ich, ...eintraege.filter((e) => e.id !== ich.id)];
	reihenfolge.forEach((e, i) =>
		befehle.push(
			db.prepare('UPDATE eintraege SET status = ?, erstellt = ? WHERE id = ?').bind(i < plaetze ? 'dabei' : 'warte', Date.now() + i, e.id)
		)
	);
	await db.batch(befehle);
	const neu = await tischLaden(db, t.id);
	return json({ tisch: tischAusgeben(neu, await eintraegeLaden(db, t.id), geraet) });
}

async function tischLoeschen(db, geraet, tischId) {
	const t = await tischLaden(db, tischId);
	if (t.gastgeber_geraet !== geraet) throw new Abbruch('Nur wer den Tisch angelegt hat, kann ihn löschen.', 403);
	await db.batch([db.prepare('DELETE FROM eintraege WHERE tisch_id = ?').bind(t.id), db.prepare('DELETE FROM tische WHERE id = ?').bind(t.id)]);
	return json({ ok: true });
}

// ---------- Verteiler ----------

export async function onRequest(context) {
	const { request, env, params } = context;
	const url = new URL(request.url);
	const teile = Array.isArray(params.pfad) ? params.pfad : String(params.pfad || '').split('/').filter(Boolean);
	const methode = request.method.toUpperCase();

	try {
		if (teile[0] === 'termine' && methode === 'GET') {
			try {
				const termine = await termineHolen(env);
				return json({ termine }, 200, { 'cache-control': 'public, max-age=300' });
			} catch (e) {
				return json({ termine: [], fehler: 'Der Kalender ist gerade nicht erreichbar.' }, 200);
			}
		}

		if (!env.DB) return fehler('Die Datenbank ist noch nicht verbunden (Bindung „DB“ fehlt).', 500);
		const db = env.DB;
		await vorbereiten(db);
		const geraet = geraetKennung(request);

		if (teile[0] === 'tische' && teile.length === 1) {
			if (methode === 'GET') return await tischeListe(db, url, geraet);
			if (methode === 'POST') return await tischAnlegen(db, request, geraet);
		}
		if (teile[0] === 'tische' && teile.length === 2 && methode === 'DELETE') return await tischLoeschen(db, geraet, teile[1]);
		if (teile[0] === 'tische' && teile[2] === 'eintraege' && methode === 'POST') return await eintragen(db, request, geraet, teile[1]);
		if (teile[0] === 'tische' && teile[2] === 'mitbringen' && methode === 'POST') return await mitbringen(db, request, geraet, teile[1]);
		if (teile[0] === 'eintraege' && teile.length === 2 && methode === 'DELETE') return await austragen(db, geraet, teile[1]);

		return fehler('Unbekannte Adresse.', 404);
	} catch (e) {
		if (e instanceof Abbruch) return fehler(e.message, e.status);
		console.error(e);
		return fehler('Da ist etwas schiefgelaufen. Bitte gleich nochmal versuchen.', 500);
	}
}
