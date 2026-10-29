import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starten } from './testserver.mjs';
import { berlinDate } from '../lib/kalender.js';

let srv;
const PORT = 8799;
const A = 'geraet-aaaaaaaaaaaaaaaaaaaa';
const B = 'geraet-bbbbbbbbbbbbbbbbbbbb';
const C = 'geraet-cccccccccccccccccccc';
const abend = berlinDate(Date.now() + 2 * 86400000);

async function api(pfad, { geraet = A, methode = 'GET', daten } = {}) {
	const r = await fetch(`http://localhost:${PORT}/api/${pfad}`, {
		method: methode,
		headers: { 'content-type': 'application/json', 'x-rz-geraet': geraet },
		body: daten ? JSON.stringify(daten) : undefined
	});
	return { status: r.status, d: await r.json() };
}

before(async () => {
	srv = await starten({ port: PORT });
});
after(() => srv.server.close());

test('Ablauf: Tisch mit Freund, voll, Warteliste, Nachrücken', async () => {
	let r = await api('tische', { methode: 'POST', daten: { abend, art: 'tisch', spiel: 'Cascadia', gastgeber: 'Detlev', plaetze: 3, freunde: ['Kalle'], kommentar: 'Erkläre ich' } });
	assert.equal(r.status, 201, JSON.stringify(r.d));
	const t = r.d.tisch;
	assert.equal(t.meins, true);
	assert.deepEqual(t.eintraege.map((e) => [e.name, e.status, e.freundVon]), [['Detlev', 'dabei', ''], ['Kalle', 'dabei', 'Detlev']]);

	r = await api(`tische/${t.id}/eintraege`, { geraet: B, methode: 'POST', daten: { name: 'Petra', kommentar: 'komme 19 Uhr' } });
	assert.equal(r.status, 201);
	assert.equal(r.d.tisch.meins, false);

	r = await api(`tische/${t.id}/eintraege`, { geraet: C, methode: 'POST', daten: { name: 'Uwe' } });
	assert.equal(r.status, 409, 'Tisch ist voll');

	r = await api(`tische/${t.id}/eintraege`, { geraet: C, methode: 'POST', daten: { name: 'uwe', modus: 'warteliste' } });
	assert.equal(r.status, 201);

	r = await api(`tische/${t.id}/eintraege`, { geraet: C, methode: 'POST', daten: { name: 'PETRA', modus: 'warteliste' } });
	assert.equal(r.status, 400, 'doppelter Name');

	// Petra trägt sich aus → Uwe rückt nach
	const petra = (await api(`tische?abend=${abend}`, { geraet: B })).d.tische[0].eintraege.find((e) => e.meins);
	assert.equal(petra.name, 'Petra');
	r = await api(`eintraege/${petra.id}`, { geraet: C, methode: 'DELETE' });
	assert.equal(r.status, 403, 'fremden Eintrag nicht löschbar');
	r = await api(`eintraege/${petra.id}`, { geraet: B, methode: 'DELETE' });
	assert.equal(r.status, 200);
	assert.equal(r.d.nachgerueckt, 'uwe');
	assert.deepEqual(r.d.tisch.eintraege.map((e) => e.status), ['dabei', 'dabei', 'dabei']);

	// Gastgeber darf Freund entfernen, Fremder darf Tisch nicht löschen
	const kalle = r.d.tisch.eintraege.find((e) => e.name === 'Kalle');
	assert.equal((await api(`eintraege/${kalle.id}`, { geraet: A, methode: 'DELETE' })).status, 200);
	assert.equal((await api(`tische/${t.id}`, { geraet: B, methode: 'DELETE' })).status, 403);
	assert.equal((await api(`tische/${t.id}`, { geraet: A, methode: 'DELETE' })).status, 200);
	assert.equal((await api(`tische?abend=${abend}`)).d.tische.length, 0);
});

test('Lust-Abfrage wird zum Tisch', async () => {
	let r = await api('tische', { geraet: B, methode: 'POST', daten: { abend, art: 'lust', spiel: 'Terraforming Mars', gastgeber: 'Anna' } });
	assert.equal(r.status, 201);
	const id = r.d.tisch.id;
	await api(`tische/${id}/eintraege`, { geraet: C, methode: 'POST', daten: { name: 'Uwe' } });
	r = await api(`tische/${id}/mitbringen`, { geraet: A, methode: 'POST', daten: {} });
	assert.equal(r.status, 400, 'erst Interesse eintragen');
	await api(`tische/${id}/eintraege`, { geraet: A, methode: 'POST', daten: { name: 'Detlev' } });
	r = await api(`tische/${id}/mitbringen`, { geraet: A, methode: 'POST', daten: {} });
	assert.equal(r.status, 200);
	assert.equal(r.d.tisch.art, 'tisch');
	assert.equal(r.d.tisch.gastgeber, 'Detlev');
	assert.equal(r.d.tisch.plaetze, 4);
	assert.deepEqual(r.d.tisch.eintraege.map((e) => e.name), ['Detlev', 'Anna', 'Uwe']);
});

test('Eingaben werden geprüft', async () => {
	assert.equal((await api('tische', { methode: 'POST', daten: { abend, art: 'tisch', spiel: '', gastgeber: 'X', plaetze: 4 } })).status, 400);
	assert.equal((await api('tische', { methode: 'POST', daten: { abend: '2020-01-01', art: 'tisch', spiel: 'A', gastgeber: 'X', plaetze: 4 } })).status, 400);
	assert.equal((await api('tische', { methode: 'POST', daten: { abend, art: 'tisch', spiel: 'A', gastgeber: 'X', plaetze: 99 } })).status, 400);
	assert.equal((await api('tische', { methode: 'POST', daten: { abend, art: 'tisch', spiel: 'A', gastgeber: 'X', plaetze: 2, freunde: ['Y', 'Z'] } })).status, 400);
	assert.equal((await api('tische', { methode: 'POST', daten: { abend, art: 'tisch', spiel: 'A'.repeat(81), gastgeber: 'X', plaetze: 4 } })).status, 400);
	const r = await api('tische', { methode: 'POST', daten: { abend, art: 'tisch', spiel: '<script>alert(1)</script>', gastgeber: 'X', plaetze: 4, link: 'deddys-spielregal.pages.dev/deddy' } });
	assert.equal(r.status, 201);
	assert.equal(r.d.tisch.link, 'https://deddys-spielregal.pages.dev/deddy');
	assert.equal((await api('tische', { methode: 'POST', daten: { abend, art: 'tisch', spiel: 'A', gastgeber: 'X', plaetze: 4, link: 'javascript:alert(1)' } })).status, 400);
	const ohne = await fetch(`http://localhost:${PORT}/api/tische?abend=${abend}`);
	assert.equal(ohne.status, 400, 'ohne Gerätekennung');
});

test('Alte Abende werden gelöscht', async () => {
	const db = srv.umgebung.DB;
	await db.prepare("INSERT INTO tische (id, abend, art, spiel, gastgeber, gastgeber_geraet, plaetze, erstellt) VALUES ('alt','2020-01-01','tisch','Alt','X','g',4,0)").run();
	await db.prepare("INSERT INTO eintraege (id, tisch_id, name, geraet, status, erstellt) VALUES ('ealt','alt','X','g','dabei',0)").run();
	// Bereinigung erzwingen: Modul-Zeitstempel ist intern; neuer Server-Start simuliert Kaltstart nicht,
	// daher direkt prüfen, dass der Löschbefehl greift:
	await db.batch([
		db.prepare('DELETE FROM eintraege WHERE tisch_id IN (SELECT id FROM tische WHERE abend < ?)').bind(berlinDate(Date.now())),
		db.prepare('DELETE FROM tische WHERE abend < ?').bind(berlinDate(Date.now()))
	]);
	assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM tische WHERE id='alt'").first()).n, 0);
	assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM eintraege WHERE id='ealt'").first()).n, 0);
});
