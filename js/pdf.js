// PDF računa (pdfmake, učitava se tek kad zatreba). Izgled prati Dejanov postojeći račun.
// Finalizovani računi se uvek crtaju iz zamrznutog snimka (snapshot), nikad iz trenutnih podataka.

import { fmtMoney, dmy, ibanFormat, fileSafe } from './util.js';

let loading = null;
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('PDF-Modul konnte nicht geladen werden'));
    document.head.appendChild(s);
  });
}
export function ensurePdfMake() {
  if (!loading) loading = loadScript('vendor/pdfmake.min.js').then(() => loadScript('vendor/vfs_fonts.js'));
  return loading;
}

const GREY = '#555555';
const LINE = '#111111';

function header(pr, metaRows) {
  return {
    columns: [
      {
        width: '*',
        stack: [
          { text: pr.name, fontSize: 18, bold: true },
          { text: pr.title, fontSize: 10, color: '#333333', margin: [0, 2, 0, 6] },
          {
            table: { body: [[{ text: `${pr.name} • ${pr.street} • ${pr.plz} ${pr.city}`, fontSize: 7.5, color: GREY, margin: [0, 0, 0, 1] }]] },
            layout: { hLineWidth: (i) => (i === 1 ? 0.6 : 0), vLineWidth: () => 0, hLineColor: () => '#999999', paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 1 },
          },
        ],
      },
      {
        width: 215,
        table: {
          widths: ['*', 'auto'],
          body: metaRows.map(([k, v]) => [{ text: k, fontSize: 9.5 }, { text: v, fontSize: 9.5, bold: true, alignment: 'right' }]),
        },
        layout: {
          hLineWidth: (i, n) => (i === 0 || i === n.table.body.length ? 1.5 : 0),
          vLineWidth: (i, n) => (i === 0 || i === n.table.widths.length ? 1.5 : 0),
          hLineColor: () => LINE, vLineColor: () => LINE,
          paddingLeft: () => 10, paddingRight: () => 10,
          paddingTop: (i) => (i === 0 ? 7 : 2), paddingBottom: (i, n) => (i === n.table.body.length - 1 ? 7 : 2),
        },
      },
    ],
  };
}

function footer(pr) {
  return (page, pages) => ({
    margin: [50, 10, 50, 0],
    stack: [
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 495, y2: 0, lineWidth: 1.5, lineColor: LINE }] },
      {
        margin: [0, 5, 0, 0], fontSize: 8, color: '#444444',
        columns: [
          { stack: [{ text: 'Kontakt', bold: true, color: LINE }, pr.name, pr.street, `${pr.plz} ${pr.city}`, pr.phone ? `Tel. ${pr.phone}` : '', pr.email || ''].filter(Boolean) },
          { stack: [{ text: 'Bankverbindung', bold: true, color: LINE }, `Inhaber: ${pr.bankHolder || pr.name}`, { text: `IBAN: ${ibanFormat(pr.iban)}`, bold: true, color: LINE }, pr.bic ? `BIC: ${pr.bic}` : '', pr.bank || ''].filter(Boolean) },
          { stack: [{ text: 'Steuer / Beruf', bold: true, color: LINE }, pr.title, `Steuernummer: ${pr.steuernummer}`, pages > 1 ? { text: `Seite ${page} von ${pages}`, margin: [0, 3, 0, 0] } : ''].filter(Boolean) },
        ],
      },
    ],
  });
}

function itemsTable(s) {
  const zif = s.items.some((it) => it.ziffer);
  const head = ['Pos.', ...(zif ? ['Ziffer'] : []), 'Leistung / Beschreibung', 'Anzahl', 'Einzel (€)', 'Gesamt (€)'];
  const right = (t, extra = {}) => ({ text: t, alignment: 'right', ...extra });
  const body = [
    head.map((h, i) => (i >= head.length - 3 ? right(h, { bold: true, fontSize: 9 }) : { text: h, bold: true, fontSize: 9, alignment: i === 0 ? 'center' : 'left' })),
    ...s.items.map((it, i) => [
      { text: String(i + 1), alignment: 'center' }, ...(zif ? [it.ziffer || ''] : []), it.desc,
      right(String(it.qty)), right(fmtMoney(it.priceCents)), right(fmtMoney(it.totalCents)),
    ]),
    [{ text: 'Gesamtbetrag:', colSpan: head.length - 1, alignment: 'right', bold: true }, ...Array(head.length - 2).fill(''), right(`${fmtMoney(s.totalCents)} €`, { bold: true })],
  ];
  return {
    table: { headerRows: 1, widths: [28, ...(zif ? [45] : []), '*', 45, 62, 68], body, dontBreakRows: true },
    layout: {
      hLineWidth: (i, n) => (i === 0 || i === 1 ? 1.5 : i === n.table.body.length ? 0.5 : 0.5),
      vLineWidth: () => 0,
      hLineColor: (i) => (i <= 1 ? LINE : '#dddddd'),
      paddingTop: () => 5, paddingBottom: () => 5, paddingLeft: () => 6, paddingRight: () => 6,
    },
    margin: [0, 0, 0, 4],
  };
}

const boxed = (stack, margin = [0, 12, 0, 10]) => ({
  table: { widths: ['*'], body: [[{ stack, fontSize: 9 }]] },
  layout: { hLineWidth: () => 1.5, vLineWidth: () => 1.5, hLineColor: () => LINE, vLineColor: () => LINE, paddingLeft: () => 9, paddingRight: () => 9, paddingTop: () => 6, paddingBottom: () => 6 },
  margin,
});

const leftBar = (stack) => ({
  table: { widths: ['*'], body: [[{ stack }]] },
  layout: { hLineWidth: () => 0, vLineWidth: (i) => (i === 0 ? 3 : 0), vLineColor: () => LINE, paddingLeft: () => 11, paddingTop: () => 2, paddingBottom: () => 2 },
  margin: [0, 0, 0, 18],
});

export function invoiceDoc(s, { draft = false } = {}) {
  const pr = s.praxis;
  const storno = s.kind === 'storno';
  const title = `${storno ? 'Stornorechnung' : 'Rechnung'} Nr. ${s.number || '—'}`;
  const meta = [['Rechnungsdatum:', dmy(s.invoiceDate)], ['Rechnungs-Nr.:', s.number || '—']];
  if (storno) meta.push(['Storno zu Nr.:', s.cancelsNumber]);
  else meta.push(['Leistungsdatum:', dmy(s.serviceDate)]);

  const content = [
    header(pr, meta),
    { text: s.recipient.join('\n'), margin: [0, 34, 0, 28] },
    { text: title, fontSize: 15, bold: true, margin: [0, 0, 0, 12] },
  ];
  if (s.patientLine) content.push({ text: [{ text: 'Patient/in: ', bold: true }, s.patientLine], margin: [0, 0, 0, 6] });
  content.push({ text: s.intro, margin: [0, 0, 0, s.diagnosis ? 6 : 14] });
  if (s.diagnosis) content.push({ text: [{ text: 'Diagnose: ', bold: true }, s.diagnosis], margin: [0, 0, 0, 14] });
  content.push(itemsTable(s));

  if (s.dates.length) {
    content.push(boxed([{ text: `Behandlungsdaten (${s.dates.length} ${s.dates.length === 1 ? 'Termin' : 'Termine'}):`, bold: true, margin: [0, 0, 0, 3] }, s.datesText]));
  } else if (storno && s.datesText) {
    content.push(boxed([{ text: 'Behandlungsdaten der stornierten Rechnung:', bold: true, margin: [0, 0, 0, 3] }, s.datesText]));
  } else content.push({ text: '', margin: [0, 10, 0, 0] });

  content.push({ text: [{ text: 'Steuerlicher Hinweis: ', bold: true, color: '#222222' }, pr.taxNote], fontSize: 8.5, color: '#444444', margin: [0, 0, 0, 14] });

  if (storno) {
    content.push(leftBar([`Diese Stornorechnung hebt die Rechnung Nr. ${s.cancelsNumber} vollständig auf. Bitte betrachten Sie die ursprüngliche Rechnung als gegenstandslos.`]));
  } else {
    content.push(leftBar([
      { text: ['Bitte überweisen Sie den Gesamtbetrag von ', { text: `${fmtMoney(s.totalCents)} €`, bold: true }, s.dueDate ? ` bis zum ${dmy(s.dueDate)}` : ' innerhalb von ' + (pr.paymentDays || 14) + ' Tagen', ' auf folgendes Bankkonto:'], margin: [0, 0, 0, 4] },
      { text: [{ text: 'IBAN: ', bold: true }, { text: ibanFormat(pr.iban), bold: true }] },
      pr.bic ? { text: [{ text: 'BIC: ', bold: true }, pr.bic, pr.bank ? ` (${pr.bank})` : ''] } : '',
      { text: [{ text: 'Verwendungszweck: ', bold: true }, `Rechnung Nr. ${s.number || '—'}`], margin: [0, 2, 0, 0] },
    ].filter(Boolean)));
  }

  content.push(
    { text: pr.closing, margin: [0, 0, 0, 18] },
    { text: 'Mit freundlichen Grüßen', margin: [0, 0, 0, 18] },
    { text: pr.name, bold: true },
  );

  return {
    pageSize: 'A4',
    pageMargins: [50, 48, 50, 95],
    info: { title, author: pr.name, subject: title, creator: 'Physio-Rechnung' },
    defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.2, color: LINE },
    watermark: draft ? { text: 'ENTWURF', color: '#999999', opacity: 0.15, bold: true } : undefined,
    footer: footer(pr),
    content,
  };
}

// Zahlungserinnerung (opomena) za otvoren račun
export function reminderDoc(s, { level = 1, date, due, greeting = 'Sehr geehrte Damen und Herren,' }) {
  const pr = s.praxis;
  const title = level > 1 ? `${level}. Zahlungserinnerung` : 'Zahlungserinnerung';
  return {
    pageSize: 'A4',
    pageMargins: [50, 48, 50, 95],
    info: { title: `${title} – Rechnung Nr. ${s.number}`, author: pr.name },
    defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.25, color: LINE },
    footer: footer(pr),
    content: [
      header(pr, [['Datum:', dmy(date)], ['Rechnungs-Nr.:', s.number], ['Rechnungsdatum:', dmy(s.invoiceDate)]]),
      { text: s.recipient.join('\n'), margin: [0, 34, 0, 28] },
      { text: `${title} zur Rechnung Nr. ${s.number}`, fontSize: 15, bold: true, margin: [0, 0, 0, 14] },
      s.patientLine ? { text: [{ text: 'Patient/in: ', bold: true }, s.patientLine], margin: [0, 0, 0, 10] } : '',
      { text: greeting, margin: [0, 0, 0, 10] },
      {
        text: level > 1
          ? `leider konnte ich zu meiner Rechnung Nr. ${s.number} vom ${dmy(s.invoiceDate)} über ${fmtMoney(s.totalCents)} € trotz meiner Zahlungserinnerung bisher keinen Zahlungseingang feststellen. Ich bitte Sie dringend, den offenen Betrag bis zum ${dmy(due)} auf das unten genannte Konto zu überweisen.`
          : `bei der Durchsicht meiner Unterlagen habe ich festgestellt, dass meine Rechnung Nr. ${s.number} vom ${dmy(s.invoiceDate)} über ${fmtMoney(s.totalCents)} € (fällig am ${dmy(s.dueDate)}) noch nicht beglichen ist. Sicher handelt es sich um ein Versehen. Ich bitte Sie, den offenen Betrag bis zum ${dmy(due)} auf das unten genannte Konto zu überweisen.`,
        margin: [0, 0, 0, 10],
      },
      { text: 'Sollten Sie die Zahlung bereits veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.', margin: [0, 0, 0, 16] },
      leftBar([
        { text: ['Offener Betrag: ', { text: `${fmtMoney(s.totalCents)} €`, bold: true }] },
        { text: [{ text: 'IBAN: ', bold: true }, { text: ibanFormat(pr.iban), bold: true }] },
        pr.bic ? { text: [{ text: 'BIC: ', bold: true }, pr.bic] } : '',
        { text: [{ text: 'Verwendungszweck: ', bold: true }, `Rechnung Nr. ${s.number}`] },
      ].filter(Boolean)),
      { text: 'Mit freundlichen Grüßen', margin: [0, 0, 0, 18] },
      { text: pr.name, bold: true },
    ].filter(Boolean),
  };
}

export async function pdfBlob(doc) {
  await ensurePdfMake();
  return window.pdfMake.createPdf(doc).getBlob();
}

export function pdfName(s, prefix) {
  return `${prefix || (s.kind === 'storno' ? 'Stornorechnung' : 'Rechnung')}_${fileSafe((s.number || 'Entwurf').replace(/\//g, '-'))}_${fileSafe(s.patientName.split(' ').pop() || '')}.pdf`;
}
