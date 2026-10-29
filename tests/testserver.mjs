// Kleiner lokaler Testserver: bildet Cloudflare Pages (statische Dateien +
// Functions unter /api) und die D1-Datenbank (über node:sqlite) nach.
// Nur zum Testen – wird bei Cloudflare nicht gebraucht.
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const wurzel = fileURLToPath(new URL('..', import.meta.url));
const { onRequest } = await import(new URL('../functions/api/[[pfad]].js', import.meta.url));

export function d1(datei = ':memory:') {
	const db = new DatabaseSync(datei);
	const stmt = (sql, werte = []) => ({
		bind: (...w) => stmt(sql, w),
		async all() {
			return { results: db.prepare(sql).all(...werte), success: true };
		},
		async first() {
			return db.prepare(sql).get(...werte) ?? null;
		},
		async run() {
			const r = db.prepare(sql).run(...werte);
			return { success: true, meta: { changes: Number(r.changes) } };
		},
		_ausfuehren() {
			return db.prepare(sql).run(...werte);
		}
	});
	return {
		prepare: (sql) => stmt(sql),
		async batch(liste) {
			db.exec('BEGIN');
			try {
				const r = liste.map((s) => s._ausfuehren());
				db.exec('COMMIT');
				return r;
			} catch (e) {
				db.exec('ROLLBACK');
				throw e;
			}
		}
	};
}

const typen = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.txt': 'text/plain' };

export function starten({ port = 8788, env = {} } = {}) {
	const umgebung = { DB: d1(), ...env };
	const server = createServer(async (req, res) => {
		const url = new URL(req.url, `http://localhost:${port}`);
		if (url.pathname.startsWith('/api/')) {
			const chunks = [];
			for await (const c of req) chunks.push(c);
			const body = chunks.length ? Buffer.concat(chunks) : undefined;
			const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
			const pfad = url.pathname.slice(5).split('/').filter(Boolean);
			const antwort = await onRequest({ request, env: umgebung, params: { pfad } });
			res.writeHead(antwort.status, Object.fromEntries(antwort.headers));
			res.end(Buffer.from(await antwort.arrayBuffer()));
			return;
		}
		let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
		if (p.endsWith('/')) p += 'index.html';
		try {
			const inhalt = await readFile(join(wurzel, 'public', p));
			res.writeHead(200, { 'content-type': typen[extname(p)] || 'application/octet-stream' });
			res.end(inhalt);
		} catch {
			res.writeHead(404);
			res.end('nicht gefunden');
		}
	});
	return new Promise((ok) => server.listen(port, () => ok({ server, umgebung })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const port = Number(process.env.PORT || 8788);
	const kalenderDatei = process.env.KALENDER_DATEI;
	if (kalenderDatei) {
		// Kalender aus Datei statt aus dem Internet
		const text = await readFile(kalenderDatei, 'utf8');
		const echtesFetch = globalThis.fetch;
		globalThis.fetch = async (u, o) => (String(u).startsWith('http://kalender.test') ? new Response(text) : echtesFetch(u, o));
	}
	await starten({ port, env: kalenderDatei ? { KALENDER_URL: 'http://kalender.test/basic.ics' } : {} });
	console.log(`Testserver läuft auf http://localhost:${port}/`);
}
