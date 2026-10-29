# Physio-Rechnung

Program za račune fizioterapeutske prakse (Privat- / Selbstzahler-Rechnungen u Nemačkoj).
Radi u browseru na računaru, telefonu i tabletu, i bez interneta. Svi podaci su **šifrovani šifrom prakse**.

- **Adresa aplikacije:** https://alertpay91.github.io/physio-rechnung/
- **Program (javni repo, bez podataka):** `alertpay91/physio-rechnung`
- **Podaci (privatni repo, samo šifrovano):** `alertpay91/physio-rechnung-daten`

---

## Kako je napravljeno (ukratko)

| | |
|---|---|
| Prijava | Samo šifra prakse. Dejan ne treba GitHub nalog. |
| Šifrovanje | AES-256-GCM, ključ iz šifre (PBKDF2-SHA256, 1.000.000 iteracija). Ključ nikad ne napušta uređaj. |
| Gde su podaci | Šifrovana kopija na svakom uređaju (IndexedDB) + šifrovano u privatnom GitHub repou. |
| Rezervne kopije | Svako čuvanje je nova verzija u repou (pun istorijat, može da se vrati bilo koja). Plus do 40 lokalnih kopija na uređaju i ručni izvoz u fajl. |
| Više uređaja | Izmene se spajaju zapis po zapis. Pre dodele broja računa aplikacija se uvek sinhronizuje, da dva uređaja ne daju isti broj. |
| Bez interneta | Sve radi; izmene se pošalju čim se veza vrati. |
| Računi | Format broja `MMYY/NN` (npr. `1026/01`), kao do sada. Posle finalizacije račun je zaključan (GoBD), ispravka samo preko storna. |

### Zašto je sigurno iako je GitHub Pages javan
- U javnom repou je samo **program** i fajl `access.json`. U njemu je pristupni ključ za privatni repo, **šifrovan šifrom prakse**.
- Podaci o pacijentima su samo u **privatnom** repou, i to šifrovani. Ni GitHub ni bilo ko drugi ne može da ih pročita bez šifre.
- Zato šifra mora biti **jaka** (aplikacija traži najmanje 12 znakova; najbolje rečenica od 4–5 reči).

> ⚠️ **Ako se šifra zaboravi, podaci se NE MOGU vratiti.** Zapiši je na papir i čuvaj na sigurnom mestu (npr. kod kuće u fascikli sa dokumentima).

---

## Prvo podešavanje (jednom, ~5 minuta)

### 1. Napravi pristupni ključ na GitHub-u (fine-grained token)
1. Otvori https://github.com/settings/personal-access-tokens/new (prijavljen kao `alertpay91`).
2. **Token name:** `Physio-Rechnung`
3. **Expiration:** najduže moguće (npr. 1 godina) — upiši u kalendar podsetnik za obnavljanje.
4. **Repository access:** *Only select repositories* → izaberi **oba**: `physio-rechnung` i `physio-rechnung-daten`.
5. **Permissions → Repository permissions → Contents:** `Read and write`. (Metadata: Read-only se uključi samo.)
6. *Generate token* → kopiraj ključ (počinje sa `github_pat_…`).

Ključ ima pristup **samo** ova dva repoa, ništa drugo na nalogu.

### 2. Otvori aplikaciju i podesi
1. Otvori https://alertpay91.github.io/physio-rechnung/
2. Ekran **Ersteinrichtung**: Dejan izabere šifru (2×) i potvrdi da ju je zapisao.
3. Izaberi **Cloud über GitHub**, nalepi ključ. Repoi su već popunjeni (`alertpay91/physio-rechnung-daten` i `alertpay91/physio-rechnung`).
4. **Einrichten.** Gotovo.

### 3. Na ostalim uređajima
Samo otvori adresu i unesi šifru. (Posle prvog podešavanja GitHub-u treba do ~2 minuta da objavi `access.json`.)
Na telefonu: u browseru *Dodaj na početni ekran* → ponaša se kao aplikacija.

### 4. Odmah posle podešavanja
- **Einstellungen → Praxis:** ime, adresa, Steuernummer, IBAN (aplikacija proverava IBAN). Dugme *Musterrechnung ansehen* pokazuje kako račun izgleda.
- **Einstellungen → Leistungen & Preise:** KG 29,70 € i HB 27,60 € su upisani; ostale cene upiši ili isključi usluge koje se ne koriste.

---

## Svakodnevni rad

1. **Patienten → Neuer Patient:** podaci, adresa (ili druga osoba kao primalac računa), Verordnung (datum, lekar, broj termina).
2. **Neue Rechnung:** izaberi pacijenta → tapni dane tretmana u kalendaru → stavke se same popune → *Finalisieren*.
   - Nacrt se čuva automatski dok kucaš.
   - Već fakturisani dani su u kalendaru zaključani (nema duple naplate).
   - Sekcija **Prüfung** pokazuje šta nedostaje pre finalizacije (bez IBAN-a, Steuernummer, termina, cene … ne može).
3. **PDF:** otvori / pošalji (na telefonu direktno u mail ili WhatsApp) / preuzmi.
4. Kad stigne uplata: **Zahlung erfasst**. Za račune koji kasne: **Zahlungserinnerung** (PDF opomene).
5. Pogrešan račun? **Korrigieren** = automatski storno račun + novi nacrt sa istim podacima za ispravku.
6. Za knjigovođu: **Rechnungen** → izaberi mesec → *CSV* ili *Alle PDFs als ZIP*.

---

## Ako nešto pođe po zlu

| Problem | Rešenje |
|---|---|
| Nešto obrisano / pogrešno izmenjeno | **Daten & Sicherung → Versionen → Ansehen… → Wiederherstellen.** Pre vraćanja se automatski pravi kopija trenutnog stanja, pa se uvek može nazad. |
| Telefon izgubljen / ukraden | Podaci na njemu su šifrovani. Za svaki slučaj promeni šifru (*Passwort ändern*) sa drugog uređaja. |
| Ključ istekao (crvena poruka „GitHub-Zugang abgelaufen“) | Napravi novi ključ (korak 1) → *Daten & Sicherung → GitHub-Zugangsschlüssel erneuern*. Ništa se ne gubi; u međuvremenu se sve čuva lokalno. |
| „Doppelte Rechnungsnummer“ | Desi se samo ako su dva uređaja istovremeno pravila račun bez interneta. Jedan od ta dva računa storniraj i napravi ponovo. |
| Greška na poslednjem računu, još nije predat | Otvori račun → **Bearbeiten** (vidi se samo za poslednji broj, ako nije označen kao poslat/plaćen). Postaje nacrt sa **istim brojem** → ispravi → *Finalisieren*. Slanje PDF-a iz aplikacije (*Senden / teilen*) račun automatski označava kao poslat. |
| Probni / pogrešan račun koji nije poslat | Otvori račun → *Weitere Aktionen* → **Rechnung löschen** (potvrda kvadratićem). Ako je bio poslednji u mesecu, broj se oslobađa (npr. `1026/02` može ponovo). |
| Posle testiranja: sve ispočetka | **Einstellungen → Alles zurücksetzen**: šifra + dve potvrde. Briše pacijente i račune na svim uređajima; podaci prakse i cene mogu da ostanu. Staro stanje ostaje u *Versionen*. |
| Dodatna sigurnost | Jednom mesečno: *Verschlüsselte Sicherung herunterladen* i sačuvaj fajl na USB / drugi disk. |
| GitHub nedostupan | Aplikacija radi normalno sa lokalnom kopijom i šalje podatke kasnije. |

---

## Pravne napomene (proveriti sa Steuerberater-om)
- Napomena na računu: *„Gemäß § 4 Nr. 14 lit. a UStG wird keine Umsatzsteuer erhoben“*. Važi za tretmane po **lekarskom nalogu (Verordnung)**. Za usluge bez naloga (wellness, prevencija bez naloga) može da važi PDV. Zato aplikacija upozorava kad račun nema datum Verordnung-a.
- Obaveza e-računa (E-Rechnung) za izdavanje **ne važi** za poreski oslobođene tretmane (§ 4 Nr. 8–29 UStG) i za račune privatnim licima. PDF je dovoljan.
- Čuvanje: račune čuvati **najmanje 10 godina**. Poslate račune ne brisati nego stornirati. *Rechnung löschen* je samo za probne/pogrešne račune koji nikad nisu poslati.
- GDPR: podaci su šifrovani pre slanja (GitHub vidi samo šifrovan tekst). Upiši ovaj program u Verzeichnis von Verarbeitungstätigkeiten prakse. Fontovi su ugrađeni (nema Google Fonts).
- GKV pacijenti: GKV usluge se naplaćuju preko kase / Abrechnungsstelle (§ 302 SGB V), ne ovim programom.

---

## Za programera

```
npm test          # testovi logike (brojevi, iznosi, provere, storno, spajanje, šifrovanje, prevodi)
npm start         # lokalni server na http://localhost:8080
```

- Bez build koraka: čist HTML/CSS/JS (ES moduli). Jedina biblioteka: `vendor/pdfmake` 0.3.11 (MIT).
- `js/model.js`: poslovna logika (bez DOM-a, potpuno testirana).
- `js/vault.js`: prijava, šifrovanje, sinhronizacija, istorija.
- `js/views/*`: ekrani. `js/i18n.js`: DE/SR prevodi (računi su uvek na nemačkom).
- Iznosi se svuda čuvaju u **centima** (celi brojevi), datumi kao lokalni `YYYY-MM-DD`, bez UTC grešaka.
- Nova verzija programa: promeni `CACHE` u `sw.js` (npr. `physio-v2`) da bi telefoni sigurno dobili novu verziju.
