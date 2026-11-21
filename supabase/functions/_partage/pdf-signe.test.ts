import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { construireDocument, empreintePdf } from './pdf';
import { signerPdf, type DossierPreuve } from './pdf-signe';
import { exemple } from './pdf.test';

const TRACE = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAASwAAABuCAYAAACdmi6mAAAEVklEQVR4nO3dS3IbOwwFUDn15tmJ978O7cQryBskrih2S+pu8QOA54wySpEEeM3+2ZcLAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJn8fH//tfVvoI+32QPI6l5AfVyv1hQ6+TF7ABk9Ok05aUE/AuugPYEktKCP/2YPIAshBPM5Ye3wKKw+rte3rftWAg7aE1hPPLq5/uwGu9CCtgTWA0eeBN4LL6EF7QisO868tiC0oC+BteGVd6yEFvQjsG78fH//1eKFUKHFls/664PzvJX9x7Mnga3+T2/Cr8mXEW1YrEvfZhJaa9tzmtIP+y1/STjjJ59LgjXsrfOjWxH8a+nAGhFW7met6cwtBsH13LJH0dEnK/cw1nA0qHrcO61suQWZ2SBCq7azvSW09ltqMSI0htCqqUVvRejP6JZZhEhB4clhHaNeh3n1/6xiiclHCqtPQiu/3sEiuL4r/5QwYljd4wlRHiPC5Ox9r8rCbdqWoodV9PHx3axTj9PWbyUnmqm4QiuPCH0VYQwzlZtgxoIKrfii9VW08YxSamKZN37msVcWORgij62XMpOqsOE9OYwlSyBkGWcLJSZTIaw+Ca0YMoZAxjEflX4SlcLqcqk3n2wqbPoKc7gn7eArF0VozVGppyrN5VbKgVctxi2hNVbVnqo2r3QDXmkjrzTXWapt6HuqzDPNQC+XNTfwinMepcomPiL7nNN8S7jqxq0+v1myb9yzsn+fmKIwq4bVLa87tLFqUG3JuBYhB/Up44L2IrRfp5+2ZVqXUIO5lWkRRxFa5+mn5zKsUYhBfGVj3mdtjsmwCSOJvl7TB/CVDfmcNdon+uaLLOrahSqajbiftXos6obLJto6himcDXicJ4ffRdtgVURZ1+kFjLIQWQmtv/RSXxHW1y8gS87J9De9NM7MtQ71Z64uF811xsprKajmmbH2Uwq68gbrZcU1FVYxjKzD8G8JV9xYI9xbvwzfh50hrOIY+X3i0MIKq/6qr7Ggiq13ffwttYKqPjnUR3n0qlX3ImuyOaqFlj7KqXXduha6+uVJZFXWXlDl17KG3QpeZcNklr0GwqqWFvXsUvTsG6WSrLUQVnW9Utvmhc+6QSrLVBNBtY4z91mbNYBGiy1DaOmh9dzWfE+Nm7w4qtHii14HPbSmj+v17Uh9X26EDD+5+Sva6w6CiiNeOmEJqxpmfb4jrDjqdGAJq5yifHMorDjjVGMIq/xm1VBQ8YpDDaLZahkdWvqHV+2+JNRs9Yy8PNQ/tLCrUVwC1tbzyaGgoqVdJ6ytxtJsdWzVssUpS1jR2qmnhJptDa+ElrCih8M33TVbXS0u/QUVPWkg/vFKaAkrehv+RyiI7eyTQ2HFCBqJTXtPWoKKkZyw2OQSkIgEFnc9et1BWDGDxuKhI682CCp6c8Liob0hJKwYQWDx1LMwElaMotHY7evloaACwpv1G0oBAAAAAAAAAAAAAAAAAAAAAAAAANjhf747i+Gob2w/AAAAAElFTkSuQmCC'), (c) => c.charCodeAt(0));
const texte = (octets: Uint8Array) => {
  const fichier = join(mkdtempSync(join(tmpdir(), 'pdf-')), 's.pdf');
  writeFileSync(fichier, octets);
  return execFileSync('pdftotext', ['-layout', fichier, '-'], { encoding: 'utf8' }).replace(/\s+/g, ' ');
};
const dossier = (empreinte: string, essai = false): DossierPreuve => ({
  empreinte, genere_le: '2026-11-15T10:40:00Z', essai,
  signatures: [
    { partie_id: 'b', qualite: 'Bailleur', nom: 'Mme Claire Vidal', mode: 'sur_place', signe_le: '2026-11-15T10:45:12Z', ip: '203.0.113.7', appareil: 'Mozilla/5.0 (Linux; Android 14)', image: TRACE },
    { partie_id: 'l', qualite: 'Locataire', nom: 'M. Hugo Marty', mode: 'a_distance', signe_le: '2026-11-16T08:02:00Z', ip: null, appareil: null, image: null },
  ],
});

describe('exemplaire signé', () => {
  it('reprend le document, pose les signatures dans leurs cases et ajoute le dossier de preuve', async () => {
    const { octets, cases } = await construireDocument(exemple());
    expect(cases.map((c) => c.partie_id)).toEqual(['b', 'l']); // le mandataire absent n'a pas de case
    const empreinte = await empreintePdf(octets);
    const signe = await signerPdf(octets, cases, dossier(empreinte));
    expect((await PDFDocument.load(signe)).getPageCount()).toBe((await PDFDocument.load(octets)).getPageCount() + 1);
    const t = texte(signe);
    for (const attendu of ["ÉTAT DES LIEUX D'ENTRÉE", 'Dossier de preuve des signatures', empreinte, 'Bailleur — Mme Claire Vidal', 'Signé le 15/11/2026 11:45:12 (heure de Paris)',
      'Adresse IP : 203.0.113.7', 'Locataire — M. Hugo Marty', 'À distance, par lien personnel à usage unique', 'Adresse IP : non relevée', 'Lu et approuvé — signé électroniquement le 15/11/2026', 'eIDAS'])
      expect(t, attendu).toContain(attendu);
    expect(t).not.toContain('MODE TEST');
    expect(await empreintePdf(signe)).not.toBe(empreinte);
  });
  it('mode test : l’exemplaire dit que les signatures sont sans valeur', async () => {
    const { octets, cases } = await construireDocument(exemple());
    expect(texte(await signerPdf(octets, cases, dossier('a'.repeat(64), true)))).toContain('MODE TEST — signatures de démonstration, sans valeur.');
  });
  it('sans cases connues, le dossier de preuve suffit', async () => {
    const { octets } = await construireDocument(exemple());
    expect(texte(await signerPdf(octets, [], dossier('a'.repeat(64))))).toContain('Bailleur — Mme Claire Vidal');
  });
});
