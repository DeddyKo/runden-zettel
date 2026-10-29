# Runden-Zettel – Anleitung

Stand: 29.10.2026

Der Runden-Zettel ist eine kleine Webseite für den Spieletreff Tecklenburger Land:
Spiel anbieten, Link in die WhatsApp-Gruppe, andere tragen sich mit zwei Klicks ein.
Kein Login, gespeichert werden nur Vornamen und Kommentare, am Tag nach dem
Spielabend wird alles automatisch gelöscht. Die Termine kommen automatisch aus dem
Google-Kalender des Spieletreffs. Die Spieletreff-Website wird dabei nicht verändert.

---

## 1. Sofort ausprobieren (ohne Internet, ohne Cloudflare)

Doppelklick auf **`public\index.html`**. Die Seite öffnet sich im Browser im
**Probemodus**: Alles funktioniert, wird aber nur auf diesem Rechner gespeichert,
und die Termine sind Beispieltermine (alle 14 Tage freitags ab dem 30.10.).

---

## 2. Online stellen bei Cloudflare (ca. 20 Minuten, einmalig)

Die Bezeichnungen in der Cloudflare-Oberfläche können leicht abweichen.

### Schritt A – Projekt auf GitHub hochladen

1. Auf github.com anmelden (DeddyKo) → oben rechts **+** → **New repository**.
2. Name: `runden-zettel`, Sichtbarkeit **Private** (oder Public), **Create repository**.
3. Auf der leeren Repository-Seite **„uploading an existing file“** anklicken.
4. Den **Inhalt** dieses Ordners hineinziehen (die Ordner `public`, `functions`, `lib`,
   `tests` und die Dateien `package.json`, `ANLEITUNG.md`, `.gitignore`) → **Commit changes**.
   Wichtig: Die Ordner müssen oben im Repository liegen, nicht in einem Unterordner.

### Schritt B – Datenbank anlegen

1. dash.cloudflare.com → links **Speicher & Datenbanken** → **D1-SQL-Datenbank** → **Erstellen**.
2. Name: `runden-zettel` → **Erstellen**.
   (Tabellen musst du nicht anlegen – das macht der Runden-Zettel beim ersten Aufruf selbst.)

### Schritt C – Seite anlegen

1. Links **Workers & Pages** → **Erstellen** → Reiter **Pages** → **Mit Git verbinden**.
2. Repository `runden-zettel` auswählen → **Einrichtung beginnen**.
3. Build-Einstellungen:
   - Framework-Voreinstellung: **Keine**
   - Build-Befehl: **leer lassen**
   - Build-Ausgabeverzeichnis: **`public`**
4. **Speichern und bereitstellen**.

### Schritt D – Datenbank mit der Seite verbinden

1. Im neuen Pages-Projekt → **Einstellungen** → **Bindungen** (Bindings) → **Hinzufügen** → **D1-Datenbank**.
2. Variablenname: **`DB`** (genau so, Großbuchstaben) – Datenbank: `runden-zettel` → **Speichern**.
3. Reiter **Bereitstellungen** → bei der letzten Bereitstellung **⋯** → **Erneut bereitstellen**
   (erst danach ist die Datenbank verbunden).

Fertig. Die Adresse lautet dann etwa `https://runden-zettel.pages.dev`.
Ist der Name schon vergeben, hängt Cloudflare etwas an (z. B. `runden-zettel-abc.pages.dev`).

### Schritt E – Testen

- Seite öffnen → die nächsten Spielabende aus dem Kalender müssen oben erscheinen.
- Einen Test-Tisch anlegen, auf dem Handy öffnen, eintragen, wieder löschen.
- Erscheint „Die Datenbank ist noch nicht verbunden“: Schritt D prüfen (Name `DB`, erneut bereitstellen).

---

## 3. Vor dem Start mit der Gruppe

- [ ] In **`public/hinweise.html`** die orange markierten Platzhalter ausfüllen
      (Name, Anschrift, E-Mail, Datum). Ohne Impressum nicht öffentlich teilen.
- [ ] Prüfen, ob in deinem Cloudflare-Konto der Vertrag zur Auftragsverarbeitung (DPA) gilt
      (Cloudflare stellt ihn für alle Kunden bereit; im Dashboard unter Konto/Rechtliches nachsehen).
- [ ] Markus und Mario den Link schicken, bevor er in die große Gruppe geht.
- [ ] Hinweis: Das ist eine sorgfältige Vorlage, aber keine Rechtsberatung.

---

## 4. Wie es funktioniert (kurz)

| Ordner/Datei | Inhalt |
|---|---|
| `public/` | Die Webseite (Oberfläche, Schriften, Impressum/Datenschutz) |
| `functions/api/[[pfad]].js` | Der Server-Teil: Tische, Einträge, Warteliste, Löschen |
| `lib/kalender.js` | Liest den Google-Kalender des Spieletreffs (inkl. wiederkehrender und abgesagter Termine) |
| `tests/` | Automatische Tests (nur für Entwicklung, z. B. `npm test`) |

- **Termine:** Der Server liest alle 15 Minuten den öffentlichen Google-Kalender des Spieletreffs.
  Abgesagte Termine (Titel beginnt mit „Abgesagt“) werden durchgestrichen, dort kann man nichts anlegen.
- **Eigene Einträge:** Jedes Gerät bekommt eine zufällige Kennung. Nur damit kann man eigene Einträge
  ändern oder löschen. Wer einen Tisch angelegt hat, kann auch Einträge an seinem Tisch entfernen.
- **Warteliste:** Ist ein Tisch voll, landet man auf der Warteliste und rückt automatisch nach.
- **Lust-Abfrage:** Wer Interesse hat, klickt „Ich hätte auch Lust“. Wer das Spiel mitbringt,
  macht mit einem Klick einen Tisch daraus – alle Interessierten bekommen einen Platz.
- **Löschen:** Am Tag nach dem Spielabend werden alle Tische und Einträge dieses Abends gelöscht.
- **Grenzen:** max. 40 Tische pro Abend, 30 Einträge pro Tisch, 2–12 Spieler, Texte gekürzt.
- **Kosten:** Läuft im kostenlosen Cloudflare-Tarif (Pages, Functions, D1).

Kalender wechseln: In Cloudflare unter **Einstellungen → Variablen und Geheimnisse** eine Variable
`KALENDER_URL` mit der iCal-Adresse eines anderen Kalenders anlegen und erneut bereitstellen.
