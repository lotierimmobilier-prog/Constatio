// Lecture et contrôle des guides (contenu/guides/*.md). Utilisé par la
// génération des pages et par les tests : un guide mal formé fait échouer les deux.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

export const DOSSIER = new URL('../contenu/guides/', import.meta.url).pathname;
export const CATEGORIES = ['Obligations', 'Dépôt de garantie', 'Cas particuliers', 'Sur place'];

export function lireGuides(dossier = DOSSIER) {
  return readdirSync(dossier)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .map((f) => {
      const brut = readFileSync(join(dossier, f), 'utf8');
      const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(brut);
      if (!m) throw new Error(`${f} : en-tête introuvable`);
      const tete = parse(m[1]);
      const date = tete.date instanceof Date ? tete.date.toISOString().slice(0, 10) : String(tete.date);
      return { slug: f.replace(/\.md$/, ''), ...tete, date, corps: m[2].trim() };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Les défauts d'un guide : bloquants (la page serait fausse ou cassée) et avertissements. */
export function controler(guide, slugs) {
  const erreurs = [];
  const avis = [];
  const texte = (v) => typeof v === 'string' && v.trim().length > 0;
  for (const cle of ['titre', 'description', 'categorie', 'resume']) if (!texte(guide[cle])) erreurs.push(`« ${cle} » manquant`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(guide.date)) erreurs.push('date illisible');
  if (!CATEGORIES.includes(guide.categorie)) erreurs.push(`catégorie inconnue : ${guide.categorie}`);
  if (!Array.isArray(guide.points_cles) || guide.points_cles.length < 3) erreurs.push('au moins 3 points clés');
  if (!Array.isArray(guide.questions) || guide.questions.length < 3 || guide.questions.some((x) => !texte(x?.q) || !texte(x?.r))) erreurs.push('au moins 3 questions avec réponse');
  if (!Array.isArray(guide.sources) || !guide.sources.length) erreurs.push('sources manquantes');
  if (/^# /m.test(guide.corps)) erreurs.push('le corps ne doit pas contenir de titre de niveau 1');
  if (/\]\(https?:/.test(guide.corps)) erreurs.push('lien externe dans le corps');
  for (const [, cible] of guide.corps.matchAll(/\]\(\/guides\/([^)#/]+)\/?\)/g)) if (!slugs.includes(cible)) erreurs.push(`lien vers un guide inconnu : ${cible}`);
  if (texte(guide.description) && (guide.description.length < 120 || guide.description.length > 160)) avis.push(`description de ${guide.description.length} caractères (120 à 160 attendus)`);
  if (texte(guide.titre) && guide.titre.length > 65) avis.push(`titre de ${guide.titre.length} caractères (65 au plus)`);
  return { erreurs, avis };
}
