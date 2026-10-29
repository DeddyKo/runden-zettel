/* Runden-Zettel – Oberfläche
 * Läuft als Webseite mit Server (Cloudflare) oder – per Doppelklick auf
 * index.html – im Probemodus, der alles nur auf diesem Gerät speichert. */
(function () {
	'use strict';

	// ---------- Kleine Hilfen ----------

	const ZONE = 'Europe/Berlin';
	const app = document.getElementById('app');
	const meldungEl = document.getElementById('meldung');

	const esc = (s) =>
		String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

	const speicher = {
		lesen(k) {
			try { return window.localStorage.getItem(k); } catch (e) { return null; }
		},
		schreiben(k, v) {
			try { window.localStorage.setItem(k, v); } catch (e) { /* egal */ }
		},
		loeschen(k) {
			try { window.localStorage.removeItem(k); } catch (e) { /* egal */ }
		}
	};

	function zufallsId() {
		if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
		const b = new Uint8Array(16);
		crypto.getRandomValues(b);
		return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
	}

	// Gerätekennung: damit man nur eigene Einträge ändern kann (kein Name, keine Person)
	let geraet = speicher.lesen('rz-geraet');
	if (!geraet) {
		geraet = zufallsId();
		speicher.schreiben('rz-geraet', geraet);
	}

	const fmt = {
		kurz: new Intl.DateTimeFormat('de-DE', { timeZone: ZONE, weekday: 'short', day: '2-digit', month: '2-digit' }),
		lang: new Intl.DateTimeFormat('de-DE', { timeZone: ZONE, weekday: 'long', day: 'numeric', month: 'long' }),
		zeit: new Intl.DateTimeFormat('de-DE', { timeZone: ZONE, hour: '2-digit', minute: '2-digit' })
	};
	const kurzDatum = (iso) => fmt.kurz.format(new Date(iso)).replace(',', '');

	function meldung(text) {
		meldungEl.textContent = text;
		meldungEl.hidden = false;
		clearTimeout(meldung.t);
		meldung.t = setTimeout(() => (meldungEl.hidden = true), 4000);
	}

	const ICON = {
		ort: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2e3a8c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
		plus: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
		link: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
		teilen: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>',
		x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
		zurueck: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>'
	};

	// ---------- Datenquelle: Server ----------

	const server = {
		async anfrage(pfad, optionen) {
			const o = optionen || {};
			const r = await fetch('api/' + pfad, {
				method: o.methode || 'GET',
				headers: { 'content-type': 'application/json', 'x-rz-geraet': geraet },
				body: o.daten ? JSON.stringify(o.daten) : undefined,
				cache: 'no-store'
			});
			let d = {};
			try { d = await r.json(); } catch (e) { /* leer */ }
			if (!r.ok) throw new Error(d.fehler || 'Da ist etwas schiefgelaufen.');
			return d;
		},
		termine() { return this.anfrage('termine'); },
		tische(abend) { return this.anfrage('tische?abend=' + encodeURIComponent(abend)); },
		anlegen(daten) { return this.anfrage('tische', { methode: 'POST', daten }); },
		eintragen(id, daten) { return this.anfrage('tische/' + encodeURIComponent(id) + '/eintraege', { methode: 'POST', daten }); },
		austragen(eintragId) { return this.anfrage('eintraege/' + encodeURIComponent(eintragId), { methode: 'DELETE' }); },
		mitbringen(id) { return this.anfrage('tische/' + encodeURIComponent(id) + '/mitbringen', { methode: 'POST', daten: {} }); },
		loeschen(id) { return this.anfrage('tische/' + encodeURIComponent(id), { methode: 'DELETE' }); }
	};

	// ---------- Datenquelle: Probemodus (nur dieses Gerät) ----------

	const probe = (function () {
		const SCHLUESSEL = 'rz-probe-daten';
		const heute = () => new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date());
		function abende() {
			// Probe-Termine: alle 14 Tage freitags ab dem 30.10.2026, 18 Uhr
			const liste = [];
			let t = Date.UTC(2026, 9, 30, 17, 0, 0);
			const h = heute();
			while (liste.length < 4) {
				const datum = new Date(t).toISOString().slice(0, 10);
				if (datum >= h) liste.push({ datum, start: new Date(t).toISOString(), titel: 'Spieleabend', ort: 'Ev. Gemeindehaus Brochterbeck, Dorfstraße 34, 49545 Tecklenburg', abgesagt: false });
				t += 14 * 86400000;
			}
			return liste;
		}
		function laden() {
			let d = null;
			try { d = JSON.parse(speicher.lesen(SCHLUESSEL) || 'null'); } catch (e) { d = null; }
			if (!d) {
				const a = abende()[0].datum;
				const jetzt = Date.now();
				d = {
					tische: [
						{ id: 'p1', abend: a, art: 'tisch', spiel: 'Cascadia', gastgeber: 'Petra', geraet: 'x', plaetze: 4, uhrzeit: '18:30', link: '', kommentar: 'Erkläre ich gern, dauert ca. 45 Minuten.', erstellt: jetzt },
						{ id: 'p2', abend: a, art: 'tisch', spiel: 'Flügelschlag', gastgeber: 'Uwe', geraet: 'y', plaetze: 3, uhrzeit: '', link: '', kommentar: '', erstellt: jetzt + 1 },
						{ id: 'p3', abend: a, art: 'lust', spiel: 'Terraforming Mars', gastgeber: 'Anna', geraet: 'z', plaetze: 0, uhrzeit: '', link: '', kommentar: 'Hat jemand das Spiel und würde es mitbringen?', erstellt: jetzt + 2 }
					],
					eintraege: [
						{ id: 'e1', tisch: 'p1', name: 'Petra', kommentar: '', freundVon: '', geraet: 'x', status: 'dabei', erstellt: jetzt },
						{ id: 'e2', tisch: 'p1', name: 'Jens', kommentar: 'komme erst gegen 19 Uhr', freundVon: '', geraet: 'j', status: 'dabei', erstellt: jetzt + 1 },
						{ id: 'e3', tisch: 'p2', name: 'Uwe', kommentar: '', freundVon: '', geraet: 'y', status: 'dabei', erstellt: jetzt },
						{ id: 'e4', tisch: 'p2', name: 'Marion', kommentar: '', freundVon: 'Uwe', geraet: 'y', status: 'dabei', erstellt: jetzt + 1 },
						{ id: 'e5', tisch: 'p2', name: 'Anna', kommentar: '', freundVon: '', geraet: 'z', status: 'dabei', erstellt: jetzt + 2 },
						{ id: 'e6', tisch: 'p2', name: 'Heike', kommentar: '', freundVon: '', geraet: 'h', status: 'warte', erstellt: jetzt + 3 },
						{ id: 'e7', tisch: 'p3', name: 'Anna', kommentar: '', freundVon: '', geraet: 'z', status: 'lust', erstellt: jetzt },
						{ id: 'e8', tisch: 'p3', name: 'Uwe', kommentar: '', freundVon: '', geraet: 'y', status: 'lust', erstellt: jetzt + 1 }
					]
				};
			}
			return d;
		}
		const sichern = (d) => speicher.schreiben(SCHLUESSEL, JSON.stringify(d));
		const gleich = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
		function ausgabe(d, t) {
			return {
				id: t.id, abend: t.abend, art: t.art, spiel: t.spiel, gastgeber: t.gastgeber, plaetze: t.plaetze,
				uhrzeit: t.uhrzeit, link: t.link, kommentar: t.kommentar, meins: t.geraet === geraet,
				eintraege: d.eintraege.filter((e) => e.tisch === t.id).sort((a, b) => a.erstellt - b.erstellt).map((e) => ({
					id: e.id, name: e.name, kommentar: e.kommentar, freundVon: e.freundVon, status: e.status,
					meins: e.geraet === geraet, entfernbar: e.geraet === geraet || t.geraet === geraet
				}))
			};
		}
		const fehler = (text) => Promise.reject(new Error(text));
		return {
			async termine() { return { termine: abende() }; },
			async tische(abend) {
				const d = laden();
				return { abend, tische: d.tische.filter((t) => t.abend === abend).sort((a, b) => a.erstellt - b.erstellt).map((t) => ausgabe(d, t)) };
			},
			async anlegen(x) {
				const d = laden();
				const jetzt = Date.now();
				const t = { id: zufallsId(), abend: x.abend, art: x.art, spiel: x.spiel.trim(), gastgeber: x.gastgeber.trim(), geraet, plaetze: x.art === 'tisch' ? x.plaetze : 0, uhrzeit: x.uhrzeit || '', link: x.link ? (/^https?:\/\//i.test(x.link) ? x.link : 'https://' + x.link) : '', kommentar: x.kommentar || '', erstellt: jetzt };
				if (!t.spiel) return fehler('Spiel fehlt.');
				if (!t.gastgeber) return fehler('Dein Vorname fehlt.');
				d.tische.push(t);
				d.eintraege.push({ id: zufallsId(), tisch: t.id, name: t.gastgeber, kommentar: '', freundVon: '', geraet, status: t.art === 'lust' ? 'lust' : 'dabei', erstellt: jetzt });
				(x.freunde || []).forEach((f, i) => d.eintraege.push({ id: zufallsId(), tisch: t.id, name: f, kommentar: '', freundVon: t.gastgeber, geraet, status: 'dabei', erstellt: jetzt + i + 1 }));
				sichern(d);
				return { tisch: ausgabe(d, t) };
			},
			async eintragen(id, x) {
				const d = laden();
				const t = d.tische.find((y) => y.id === id);
				if (!t) return fehler('Diesen Tisch gibt es nicht mehr.');
				const name = String(x.name || '').trim();
				if (!name) return fehler('Dein Vorname fehlt.');
				const liste = d.eintraege.filter((e) => e.tisch === id);
				if (liste.some((e) => gleich(e.name, name))) return fehler(name + ' steht hier schon drin.');
				let status = t.art === 'lust' ? 'lust' : x.modus === 'warteliste' ? 'warte' : 'dabei';
				if (status === 'dabei' && liste.filter((e) => e.status === 'dabei').length >= t.plaetze) return fehler('Gerade ist der letzte Platz weggegangen. Du kannst dich auf die Warteliste setzen.');
				d.eintraege.push({ id: zufallsId(), tisch: id, name, kommentar: String(x.kommentar || '').trim(), freundVon: '', geraet, status, erstellt: Date.now() });
				sichern(d);
				return { tisch: ausgabe(d, t) };
			},
			async austragen(eintragId) {
				const d = laden();
				const e = d.eintraege.find((y) => y.id === eintragId);
				if (!e) return fehler('Diesen Eintrag gibt es nicht mehr.');
				const t = d.tische.find((y) => y.id === e.tisch);
				d.eintraege = d.eintraege.filter((y) => y.id !== eintragId);
				let nachgerueckt = '';
				if (t.art === 'tisch' && e.status === 'dabei') {
					const n = d.eintraege.filter((y) => y.tisch === t.id && y.status === 'warte').sort((a, b) => a.erstellt - b.erstellt)[0];
					if (n) { n.status = 'dabei'; nachgerueckt = n.name; }
				}
				sichern(d);
				return { nachgerueckt, tisch: ausgabe(d, t) };
			},
			async mitbringen(id) {
				const d = laden();
				const t = d.tische.find((y) => y.id === id);
				const liste = d.eintraege.filter((e) => e.tisch === id).sort((a, b) => a.erstellt - b.erstellt);
				const ich = liste.find((e) => e.geraet === geraet);
				if (!ich) return fehler('Trag dich zuerst als interessiert ein.');
				t.art = 'tisch'; t.gastgeber = ich.name; t.geraet = geraet; t.plaetze = Math.min(12, Math.max(4, liste.length));
				[ich].concat(liste.filter((e) => e !== ich)).forEach((e, i) => { e.status = i < t.plaetze ? 'dabei' : 'warte'; e.erstellt = Date.now() + i; });
				sichern(d);
				return { tisch: ausgabe(d, t) };
			},
			async loeschen(id) {
				const d = laden();
				d.tische = d.tische.filter((t) => t.id !== id);
				d.eintraege = d.eintraege.filter((e) => e.tisch !== id);
				sichern(d);
				return { ok: true };
			}
		};
	})();

	const PROBEMODUS = location.protocol === 'file:';
	const quelle = PROBEMODUS ? probe : server;
	if (PROBEMODUS) document.getElementById('probe').hidden = false;

	// ---------- Zustand ----------

	const params = new URLSearchParams(location.search);
	const merkName = speicher.lesen('rz-name') || '';
	const zustand = {
		ansicht: 'liste',
		termine: [],
		kalenderFehler: '',
		abend: params.get('abend') || '',
		tische: [],
		laedt: true,
		offen: null, // { tisch, modus }
		ich: merkName,
		merken: true,
		loeschFrage: '',
		hervor: (location.hash.match(/^#tisch-([\w-]+)$/) || [])[1] || '',
		form: null,
		beschaeftigt: false
	};

	const aktuellerTermin = () => zustand.termine.find((t) => t.datum === zustand.abend);

	// ---------- Darstellung ----------

	function render() {
		app.innerHTML = zustand.ansicht === 'neu' ? ansichtNeu() : ansichtListe();
		if (zustand.hervor) {
			const el = document.getElementById('tisch-' + zustand.hervor);
			if (el) {
				el.classList.add('hervor');
				el.scrollIntoView({ block: 'center' });
				setTimeout(() => el.classList.remove('hervor'), 2500);
				zustand.hervor = '';
			}
		}
	}

	function ansichtListe() {
		if (zustand.laedt && !zustand.termine.length) return '<p class="laden">Lade Termine …</p>';
		if (!zustand.termine.length) {
			return '<div class="hinweis-rot">' + esc(zustand.kalenderFehler || 'Gerade sind keine Termine im Kalender eingetragen.') + '</div>';
		}
		const t = aktuellerTermin();
		const abende = zustand.termine
			.map((x) => {
				const sub = x.abgesagt ? 'abgesagt' : 'ab ' + fmt.zeit.format(new Date(x.start)) + ' Uhr';
				return '<button type="button" class="abend' + (x.abgesagt ? ' abgesagt' : '') + '" data-aktion="abend" data-datum="' + esc(x.datum) + '" aria-pressed="' + (x.datum === zustand.abend) + '"><b>' + esc(kurzDatum(x.start)) + '</b><span>' + esc(sub) + '</span></button>';
			})
			.join('');

		let html = '<section class="stapel" aria-label="Spielabend wählen"><div class="etikett">Nächste Spielabende</div><div class="abende">' + abende + '</div>';
		if (t) {
			html += '<div class="karte-info">' + ICON.ort + '<div><div><strong>' + esc(fmt.lang.format(new Date(t.start))) + ', ab ' + esc(fmt.zeit.format(new Date(t.start))) + ' Uhr</strong></div>' +
				(t.ort ? '<div class="grau">' + esc(t.ort) + '</div>' : '') +
				(t.titel && !/^spiele?abend$/i.test(t.titel) ? '<div class="grau">' + esc(t.titel) + '</div>' : '') +
				'</div></div>';
			if (t.abgesagt) html += '<div class="hinweis-rot">Dieser Spielabend ist abgesagt.</div>';
		}
		html += '</section>';

		if (zustand.ich) {
			html += '<div class="ich-zeile"><span>Du trägst dich ein als <strong>' + esc(zustand.ich) + '</strong></span><button type="button" class="knopf-text" data-aktion="name-vergessen">Anderer Name</button></div>';
		}

		const gesperrt = t && t.abgesagt ? ' disabled' : '';
		html += '<div class="aktionen-oben"><button type="button" class="knopf-gross" data-aktion="neu" data-art="tisch"' + gesperrt + '>' + ICON.plus + 'Ich bringe ein Spiel mit</button>' +
			'<button type="button" class="knopf-gross hell" data-aktion="neu" data-art="lust"' + gesperrt + '>Wer hätte Lust auf …?</button></div>';

		if (zustand.laedt && !zustand.tische.length) html += '<p class="laden">Lade Tische …</p>';
		else if (!zustand.tische.length) html += '<div class="leer"><strong>Noch keine Tische für diesen Abend</strong>Bring ein Spiel mit oder frag, wer Lust auf etwas hat. Spontan am Tisch geht natürlich immer.</div>';
		else html += zustand.tische.map(tischKarte).join('');
		return html;
	}

	function tischKarte(t) {
		const istTisch = t.art === 'tisch';
		const dabei = t.eintraege.filter((e) => e.status === 'dabei');
		const warte = t.eintraege.filter((e) => e.status === 'warte');
		const lust = t.eintraege.filter((e) => e.status === 'lust');
		const meiner = t.eintraege.find((e) => e.meins && !e.freundVon);
		const frei = istTisch ? t.plaetze - dabei.length : 0;
		const voll = istTisch && frei <= 0;
		const offen = zustand.offen && zustand.offen.tisch === t.id;

		let h = '<article class="tisch" id="tisch-' + esc(t.id) + '"><div class="tisch-kopf"><div>' +
			'<div class="art' + (istTisch ? '' : ' lust') + '">' + (istTisch ? 'Tisch' : 'Wer hat Lust?') + '</div>' +
			'<h2>' + esc(t.spiel) + '</h2>' +
			'<div class="von">' + (istTisch ? 'bringt ' + esc(t.gastgeber) + ' mit' + (t.uhrzeit ? ' · Start ca. ' + esc(t.uhrzeit) + (/uhr/i.test(t.uhrzeit) ? '' : ' Uhr') : '') : 'gefragt von ' + esc(t.gastgeber)) + '</div>' +
			'</div>' + (istTisch ? '<div class="marke-frei' + (voll ? ' voll' : '') + '">' + (voll ? 'voll' : frei === 1 ? '1 Platz frei' : frei + ' Plätze frei') + '</div>' : '') + '</div>';

		if (t.kommentar) h += '<p class="zitat">„' + esc(t.kommentar) + '“</p>';
		if (t.link) h += '<a class="regal-link" href="' + esc(t.link) + '" target="_blank" rel="noopener noreferrer">' + ICON.link + 'Spiel im Spielregal ansehen</a>';

		if (istTisch) {
			let plaetze = '';
			for (let i = 0; i < t.plaetze; i++) {
				const e = dabei[i];
				if (e) {
					const notiz = e.freundVon ? 'eingetragen von ' + e.freundVon : e.kommentar;
					const x = e.entfernbar && !(e.meins && !e.freundVon) ? '<button type="button" class="platz-x" data-aktion="entfernen" data-eintrag="' + esc(e.id) + '" aria-label="' + esc(e.name) + ' entfernen">' + ICON.x + '</button>' : '';
					plaetze += '<div class="platz' + (e.meins && !e.freundVon ? ' ich' : '') + '"><div><b>' + esc(e.name) + (e.meins && !e.freundVon ? ' (du)' : '') + '</b>' + (notiz ? '<small>' + esc(notiz) + '</small>' : '') + '</div>' + x + '</div>';
				} else plaetze += '<div class="platz frei"><div><b>frei</b></div></div>';
			}
			h += '<div class="stapel" style="gap:8px"><div class="unteretikett">Plätze</div><div class="plaetze">' + plaetze + '</div>';
			if (warte.length) h += '<div class="warteliste"><strong>Warteliste:</strong> ' + warte.map((e) => esc(e.name) + (e.kommentar ? ' (' + esc(e.kommentar) + ')' : '')).join(', ') + '</div>';
			h += '</div>';
		} else {
			h += '<div class="lust-zeile"><strong>' + (lust.length === 1 ? '1 hätte Lust:' : lust.length + ' hätten Lust:') + '</strong> ' + lust.map((e) => esc(e.name) + (e.kommentar ? ' (' + esc(e.kommentar) + ')' : '')).join(', ') + '</div>';
		}

		if (offen) {
			const titel = { dabei: 'Platz reservieren', warteliste: 'Auf die Warteliste', lust: 'Ich hätte auch Lust' }[zustand.offen.modus];
			h += '<form class="panel" data-form="eintragen" data-tisch="' + esc(t.id) + '"><div class="panel-titel">' + titel + '</div>' +
				'<label class="feld">Dein Vorname<input name="name" type="text" maxlength="30" autocomplete="given-name" required value="' + esc(zustand.ich) + '" placeholder="z. B. Detlev"></label>' +
				'<label class="feld">Kommentar (optional)<input name="kommentar" type="text" maxlength="200" placeholder="z. B. komme erst gegen 19 Uhr"></label>' +
				'<label class="haken"><input name="merken" type="checkbox"' + (zustand.merken ? ' checked' : '') + '>Namen auf diesem Gerät merken</label>' +
				'<div class="knoepfe"><button type="submit" class="knopf haupt">Eintragen</button><button type="button" class="knopf klein" data-aktion="abbrechen">Abbrechen</button></div></form>';
		} else {
			let k = '';
			if (istTisch) {
				if (!meiner && !voll) k += '<button type="button" class="knopf haupt" data-aktion="oeffnen" data-modus="dabei" data-tisch="' + esc(t.id) + '">Bin dabei</button>';
				if (!meiner && voll) k += '<button type="button" class="knopf breit" data-aktion="oeffnen" data-modus="warteliste" data-tisch="' + esc(t.id) + '">Auf die Warteliste</button>';
				if (meiner && meiner.status === 'dabei' && !t.meins) k += '<button type="button" class="knopf klein" data-aktion="entfernen" data-eintrag="' + esc(meiner.id) + '">Austragen</button>';
				if (meiner && meiner.status === 'warte') k += '<button type="button" class="knopf klein" data-aktion="entfernen" data-eintrag="' + esc(meiner.id) + '">Von Warteliste nehmen</button>';
			} else {
				if (!meiner) k += '<button type="button" class="knopf haupt" data-aktion="oeffnen" data-modus="lust" data-tisch="' + esc(t.id) + '">Ich hätte auch Lust</button>';
				if (meiner) k += '<button type="button" class="knopf blau" data-aktion="mitbringen" data-tisch="' + esc(t.id) + '">Ich bringe es mit</button>';
				if (meiner && !t.meins) k += '<button type="button" class="knopf klein" data-aktion="entfernen" data-eintrag="' + esc(meiner.id) + '">Doch keine Lust</button>';
			}
			k += '<button type="button" class="knopf teilen" data-aktion="teilen" data-tisch="' + esc(t.id) + '">' + ICON.teilen + 'Teilen</button>';
			if (t.meins) {
				const sicher = zustand.loeschFrage === t.id;
				k += '<button type="button" class="knopf loeschen' + (sicher ? ' sicher' : '') + '" data-aktion="loeschen" data-tisch="' + esc(t.id) + '">' + (sicher ? 'Wirklich löschen?' : 'Löschen') + '</button>';
			}
			h += '<div class="knoepfe">' + k + '</div>';
		}
		return h + '</article>';
	}

	function ansichtNeu() {
		const f = zustand.form;
		const t = aktuellerTermin();
		const istTisch = f.art === 'tisch';
		const frei = f.plaetze - 1 - f.freunde.length;
		let h = '<form class="stapel" style="gap:16px" data-form="neu" novalidate>' +
			'<button type="button" class="zurueck" data-aktion="zurueck">' + ICON.zurueck + 'Zurück</button>' +
			'<div><h2 class="titel">' + (istTisch ? 'Ich bringe ein Spiel mit' : 'Wer hätte Lust auf …?') + '</h2><div class="klein-grau" style="font-size:15px">für ' + esc(t ? fmt.lang.format(new Date(t.start)) : zustand.abend) + '</div></div>' +
			'<div class="umschalter" role="group" aria-label="Art"><button type="button" data-aktion="art" data-art="tisch" aria-pressed="' + istTisch + '">Ich bringe es mit</button><button type="button" data-aktion="art" data-art="lust" aria-pressed="' + !istTisch + '">Nur Lust abfragen</button></div>' +
			'<div class="formkarte">' +
			'<label class="feld">Spiel<input name="spiel" type="text" maxlength="80" required value="' + esc(f.spiel) + '" placeholder="z. B. Cascadia"></label>';
		if (istTisch) {
			h += '<div class="zaehler-zeile"><div><div style="font-size:14px;font-weight:700">Spieler insgesamt</div><div class="klein-grau">inklusive dir</div></div>' +
				'<div class="zaehler"><button type="button" data-aktion="plaetze" data-wert="-1" aria-label="Ein Platz weniger">−</button><output aria-live="polite">' + f.plaetze + '</output><button type="button" data-aktion="plaetze" data-wert="1" aria-label="Ein Platz mehr">+</button></div></div>' +
				'<div class="stapel" style="gap:6px"><div style="font-size:14px;font-weight:700">Freunde schon eintragen (optional)</div><div class="klein-grau">Wer schon fest mitspielt, bekommt direkt einen Platz.</div>' +
				'<div class="zeile"><label class="nur-vorleser" for="freund">Name eines Freundes</label><input id="freund" name="freund" class="eingabe" type="text" maxlength="30" placeholder="Name" value="' + esc(f.freundEingabe) + '"><button type="button" class="knopf klein" data-aktion="freund">Hinzufügen</button></div>' +
				'<div class="chips">' + f.freunde.map((n, i) => '<span class="chip">' + esc(n) + '<button type="button" data-aktion="freund-weg" data-index="' + i + '" aria-label="' + esc(n) + ' entfernen">' + ICON.x + '</button></span>').join('') + '</div>' +
				'<div class="klein-grau" style="font-size:13px">' + (frei === 1 ? 'Danach ist noch 1 Platz frei für die Gruppe.' : 'Danach sind noch ' + frei + ' Plätze frei für die Gruppe.') + '</div></div>' +
				'<label class="feld">Startzeit (optional)<input name="uhrzeit" type="text" maxlength="10" value="' + esc(f.uhrzeit) + '" placeholder="z. B. 18:30"></label>' +
				'<label class="feld">Link zum Spiel in deinem Spielregal (optional)<input name="link" type="url" maxlength="300" value="' + esc(f.link) + '" placeholder="https://…"></label>';
		}
		h += '<label class="feld">Kommentar (optional)<input name="kommentar" type="text" maxlength="200" value="' + esc(f.kommentar) + '" placeholder="' + (istTisch ? 'z. B. Erkläre ich gern' : 'z. B. Hat jemand das Spiel?') + '"></label>' +
			'<label class="feld">Dein Vorname<input name="gastgeber" type="text" maxlength="30" autocomplete="given-name" required value="' + esc(f.gastgeber) + '" placeholder="z. B. Detlev"></label>' +
			'<label class="haken"><input name="merken" type="checkbox"' + (zustand.merken ? ' checked' : '') + '>Namen auf diesem Gerät merken</label>' +
			'</div><button type="submit" class="speichern">' + (istTisch ? 'Tisch anlegen' : 'Abfrage starten') + '</button></form>';
		return h;
	}

	// ---------- Daten laden ----------

	async function termineLaden() {
		try {
			const d = await quelle.termine();
			zustand.termine = (d.termine || []).slice(0, 4);
			zustand.kalenderFehler = d.fehler || '';
		} catch (e) {
			zustand.kalenderFehler = 'Die Termine konnten gerade nicht geladen werden. Bitte später nochmal versuchen.';
		}
		if (!zustand.termine.some((t) => t.datum === zustand.abend)) {
			const erster = zustand.termine.find((t) => !t.abgesagt) || zustand.termine[0];
			zustand.abend = erster ? erster.datum : '';
		}
	}

	async function tischeLaden(still) {
		if (!zustand.abend) { zustand.laedt = false; render(); return; }
		if (!still) { zustand.laedt = true; zustand.tische = []; render(); }
		try {
			const d = await quelle.tische(zustand.abend);
			if (d.abend === zustand.abend) zustand.tische = d.tische || [];
		} catch (e) {
			if (!still) meldung(e.message);
		}
		zustand.laedt = false;
		if (!still || (zustand.ansicht === 'liste' && !zustand.offen && !zustand.beschaeftigt)) render();
	}

	function tischErsetzen(t) {
		const i = zustand.tische.findIndex((x) => x.id === t.id);
		if (i >= 0) zustand.tische[i] = t;
		else zustand.tische.push(t);
	}

	function nameMerken(name, merken) {
		zustand.merken = merken;
		if (merken) {
			zustand.ich = name;
			speicher.schreiben('rz-name', name);
		} else {
			zustand.ich = '';
			speicher.loeschen('rz-name');
		}
	}

	function formAuslesen() {
		const form = app.querySelector('form[data-form="neu"]');
		if (!form) return;
		const f = zustand.form;
		const wert = (n) => (form.elements[n] ? form.elements[n].value : f[n] == null ? '' : f[n]);
		f.spiel = wert('spiel');
		f.kommentar = wert('kommentar');
		f.gastgeber = wert('gastgeber');
		if (form.elements.uhrzeit) f.uhrzeit = form.elements.uhrzeit.value;
		if (form.elements.link) f.link = form.elements.link.value;
		if (form.elements.freund) f.freundEingabe = form.elements.freund.value;
		if (form.elements.merken) zustand.merken = form.elements.merken.checked;
	}

	async function mitSperre(fn) {
		if (zustand.beschaeftigt) return;
		zustand.beschaeftigt = true;
		app.querySelectorAll('button').forEach((b) => (b.disabled = true));
		try {
			await fn();
		} catch (e) {
			meldung(e.message || 'Da ist etwas schiefgelaufen.');
		} finally {
			zustand.beschaeftigt = false;
			render();
		}
	}

	async function teilen(t) {
		const termin = aktuellerTermin();
		const datum = termin ? kurzDatum(termin.start) : '';
		const basis = location.protocol === 'file:' ? 'https://runden-zettel.pages.dev/' : location.origin + location.pathname;
		const url = basis + '?abend=' + encodeURIComponent(zustand.abend) + '#tisch-' + t.id;
		const dabei = t.eintraege.filter((e) => e.status === 'dabei').length;
		const frei = t.plaetze - dabei;
		const text = t.art === 'lust'
			? 'Wer hätte Lust auf ' + t.spiel + ' (' + datum + ')? Hier eintragen:'
			: t.spiel + ' am ' + datum + (frei > 0 ? ': noch ' + frei + (frei === 1 ? ' Platz' : ' Plätze') + ' frei.' : ': Tisch ist voll, Warteliste offen.') + ' Hier eintragen:';
		if (PROBEMODUS) { meldung('Probemodus: Im echten Betrieb öffnet sich hier WhatsApp mit dem Link zu „' + t.spiel + '“.'); return; }
		if (navigator.share) {
			try { await navigator.share({ title: 'Runden-Zettel', text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
		}
		window.open('https://wa.me/?text=' + encodeURIComponent(text + ' ' + url), '_blank', 'noopener');
	}

	// ---------- Bedienung ----------

	app.addEventListener('click', (ev) => {
		const el = ev.target.closest('[data-aktion]');
		if (!el || el.disabled) return;
		const a = el.dataset.aktion;
		const tisch = el.dataset.tisch ? zustand.tische.find((t) => t.id === el.dataset.tisch) : null;

		if (a === 'abend') {
			zustand.abend = el.dataset.datum;
			zustand.offen = null;
			zustand.loeschFrage = '';
			const u = new URL(location.href);
			u.searchParams.set('abend', zustand.abend);
			u.hash = '';
			try { history.replaceState(null, '', u.toString()); } catch (e) { /* file:// */ }
			tischeLaden();
		} else if (a === 'name-vergessen') {
			nameMerken('', false);
			zustand.merken = true;
			meldung('Name vergessen. Beim nächsten Eintrag fragen wir neu.');
			render();
		} else if (a === 'neu') {
			zustand.offen = null;
			zustand.form = { art: el.dataset.art, spiel: '', plaetze: 4, uhrzeit: '', link: '', kommentar: '', gastgeber: zustand.ich, freunde: [], freundEingabe: '' };
			zustand.ansicht = 'neu';
			render();
			window.scrollTo(0, 0);
			const s = app.querySelector('input[name="spiel"]');
			if (s) s.focus();
		} else if (a === 'zurueck') {
			zustand.ansicht = 'liste';
			render();
		} else if (a === 'art') {
			formAuslesen();
			zustand.form.art = el.dataset.art;
			render();
		} else if (a === 'plaetze') {
			formAuslesen();
			const f = zustand.form;
			const neu = f.plaetze + Number(el.dataset.wert);
			if (neu >= Math.max(2, f.freunde.length + 1) && neu <= 12) f.plaetze = neu;
			render();
		} else if (a === 'freund') {
			formAuslesen();
			const f = zustand.form;
			const n = f.freundEingabe.trim();
			if (n) {
				if (f.freunde.length >= f.plaetze - 1) meldung('Es sind keine Plätze mehr frei. Erhöhe erst die Spielerzahl.');
				else if (f.freunde.some((x) => x.toLowerCase() === n.toLowerCase())) meldung(n + ' ist schon eingetragen.');
				else { f.freunde.push(n.slice(0, 30)); f.freundEingabe = ''; }
			}
			render();
			const i = app.querySelector('input[name="freund"]');
			if (i) i.focus();
		} else if (a === 'freund-weg') {
			formAuslesen();
			zustand.form.freunde.splice(Number(el.dataset.index), 1);
			render();
		} else if (a === 'oeffnen' && tisch) {
			zustand.offen = { tisch: tisch.id, modus: el.dataset.modus };
			render();
			const i = app.querySelector('form[data-form="eintragen"] input[name="' + (zustand.ich ? 'kommentar' : 'name') + '"]');
			if (i) i.focus();
		} else if (a === 'abbrechen') {
			zustand.offen = null;
			render();
		} else if (a === 'entfernen') {
			const eintragId = el.dataset.eintrag;
			mitSperre(async () => {
				const d = await quelle.austragen(eintragId);
				tischErsetzen(d.tisch);
				meldung(d.nachgerueckt ? 'Ausgetragen. ' + d.nachgerueckt + ' rückt von der Warteliste nach.' : 'Ausgetragen.');
			});
		} else if (a === 'mitbringen' && tisch) {
			mitSperre(async () => {
				const d = await quelle.mitbringen(tisch.id);
				tischErsetzen(d.tisch);
				meldung('Super! Aus der Abfrage ist jetzt ein Tisch geworden.');
			});
		} else if (a === 'loeschen' && tisch) {
			if (zustand.loeschFrage !== tisch.id) {
				zustand.loeschFrage = tisch.id;
				render();
				setTimeout(() => { if (zustand.loeschFrage === tisch.id) { zustand.loeschFrage = ''; render(); } }, 5000);
				return;
			}
			zustand.loeschFrage = '';
			mitSperre(async () => {
				await quelle.loeschen(tisch.id);
				zustand.tische = zustand.tische.filter((t) => t.id !== tisch.id);
				meldung('„' + tisch.spiel + '“ wurde gelöscht.');
			});
		} else if (a === 'teilen' && tisch) {
			teilen(tisch);
		}
	});

	app.addEventListener('keydown', (ev) => {
		if (ev.key === 'Enter' && ev.target.name === 'freund') {
			ev.preventDefault();
			const b = app.querySelector('[data-aktion="freund"]');
			if (b) b.click();
		}
	});

	app.addEventListener('submit', (ev) => {
		ev.preventDefault();
		const form = ev.target;
		if (form.dataset.form === 'eintragen') {
			const name = form.elements.name.value.trim();
			const kommentar = form.elements.kommentar.value.trim();
			const merken = form.elements.merken.checked;
			if (!name) { meldung('Bitte gib deinen Vornamen ein.'); form.elements.name.focus(); return; }
			const tischId = form.dataset.tisch;
			const modus = zustand.offen ? zustand.offen.modus : 'dabei';
			mitSperre(async () => {
				const d = await quelle.eintragen(tischId, { name, kommentar, modus });
				tischErsetzen(d.tisch);
				nameMerken(name, merken);
				zustand.offen = null;
				meldung(modus === 'warteliste' ? 'Du stehst auf der Warteliste. Wird ein Platz frei, rückst du automatisch nach.' : modus === 'lust' ? 'Notiert! Vielleicht bringt es ja jemand mit.' : 'Du bist dabei bei ' + d.tisch.spiel + '!');
			});
		} else if (form.dataset.form === 'neu') {
			formAuslesen();
			const f = zustand.form;
			if (!f.spiel.trim()) { meldung('Welches Spiel? Bitte trag den Namen ein.'); form.elements.spiel.focus(); return; }
			if (!f.gastgeber.trim()) { meldung('Bitte gib deinen Vornamen ein.'); form.elements.gastgeber.focus(); return; }
			const pending = f.freundEingabe.trim();
			if (pending && f.art === 'tisch' && f.freunde.length < f.plaetze - 1 && !f.freunde.some((x) => x.toLowerCase() === pending.toLowerCase())) f.freunde.push(pending);
			mitSperre(async () => {
				const d = await quelle.anlegen({
					abend: zustand.abend, art: f.art, spiel: f.spiel.trim(), gastgeber: f.gastgeber.trim(),
					plaetze: f.plaetze, uhrzeit: f.uhrzeit.trim(), link: f.link.trim(), kommentar: f.kommentar.trim(),
					freunde: f.art === 'tisch' ? f.freunde : []
				});
				nameMerken(f.gastgeber.trim(), zustand.merken);
				tischErsetzen(d.tisch);
				zustand.ansicht = 'liste';
				zustand.hervor = d.tisch.id;
				meldung(f.art === 'tisch' ? 'Tisch angelegt. Teile jetzt den Link in der WhatsApp-Gruppe.' : 'Abfrage angelegt. Teile den Link in der WhatsApp-Gruppe.');
			});
		}
	});

	// Regelmäßig aktualisieren, solange die Seite sichtbar ist und niemand tippt
	setInterval(() => {
		if (document.visibilityState === 'visible' && zustand.ansicht === 'liste' && !zustand.offen && !zustand.beschaeftigt) tischeLaden(true);
	}, 30000);
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible' && zustand.ansicht === 'liste' && !zustand.offen) tischeLaden(true);
	});

	// ---------- Start ----------

	(async function start() {
		await termineLaden();
		zustand.laedt = false;
		render();
		await tischeLaden();
	})();
})();
