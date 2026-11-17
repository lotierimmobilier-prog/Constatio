export const LONGUEUR_MOT_DE_PASSE = 10;

export function emailValide(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

export function motDePasseValide(v: string): boolean {
  return v.length >= LONGUEUR_MOT_DE_PASSE;
}

/** SIRET : 14 chiffres dont la somme de contrôle (Luhn) est un multiple de 10. */
export function siretValide(v: string): boolean {
  const s = v.replace(/\s/g, '');
  if (!/^\d{14}$/.test(s)) return false;
  let somme = 0;
  for (let i = 0; i < 14; i++) {
    let n = Number(s[13 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    somme += n;
  }
  return somme % 10 === 0;
}

export function codePostalValide(v: string): boolean {
  return /^\d{5}$/.test(v.trim());
}
