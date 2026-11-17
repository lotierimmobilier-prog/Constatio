// Les messages du service d'authentification arrivent en anglais : on les
// remplace par une phrase qui dit quoi faire.
const PAR_CODE: Record<string, string> = {
  invalid_credentials: 'E-mail ou mot de passe incorrect.',
  email_not_confirmed: 'Votre adresse e-mail n’est pas encore confirmée. Ouvrez le lien reçu par e-mail.',
  user_already_exists: 'Un compte existe déjà avec cette adresse. Connectez-vous ou réinitialisez votre mot de passe.',
  email_exists: 'Un compte existe déjà avec cette adresse. Connectez-vous ou réinitialisez votre mot de passe.',
  weak_password: 'Ce mot de passe est trop simple. Choisissez-en un plus long.',
  same_password: 'Le nouveau mot de passe doit être différent de l’ancien.',
  over_email_send_rate_limit: 'Trop d’e-mails envoyés. Patientez quelques minutes avant de réessayer.',
  over_request_rate_limit: 'Trop de tentatives. Patientez quelques minutes avant de réessayer.',
  signup_disabled: 'Les inscriptions sont momentanément fermées.',
  otp_expired: 'Ce lien a expiré. Demandez-en un nouveau.',
  session_not_found: 'Votre session a expiré. Reconnectez-vous.',
};

const PAR_MESSAGE: [RegExp, string][] = [
  [/invalid login credentials/i, PAR_CODE.invalid_credentials],
  [/already registered/i, PAR_CODE.user_already_exists],
  [/failed to fetch|networkerror|load failed/i, 'Connexion impossible. Vérifiez votre réseau puis réessayez.'],
];

export function traduireErreur(erreur: unknown): string {
  const e = (erreur ?? {}) as { code?: string; message?: string };
  if (e.code && PAR_CODE[e.code]) return PAR_CODE[e.code];
  for (const [motif, texte] of PAR_MESSAGE) if (e.message && motif.test(e.message)) return texte;
  return 'Une erreur est survenue. Réessayez dans un instant.';
}
