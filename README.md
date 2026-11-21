# Constatio

Service d'états des lieux numériques, partenaire de Signabail. Cahier des charges et livrables de conception dans `docs/`.

## Démarrer en local

```bash
npm install
dev/pile-locale.sh start   # base, authentification, API et boîte mail de test (Docker)
npm run dev                # http://127.0.0.1:5173
```

`dev/pile-locale.sh` écrit `.env.local`. Avec un vrai projet Supabase, copier `.env.example` en `.env.local` et y mettre l'URL et la clé « anon » du projet.

## Tests

```bash
npm test            # fonctions (validation, messages d'erreur)
npm run test:db     # schéma et règles d'accès, sur un Postgres local
npm run e2e -- --trace off   # parcours sur téléphone, contre la pile locale
```

## Administration

L'espace d'administration est à l'adresse `/admin`. Le premier super administrateur se désigne une fois, au déploiement, depuis l'éditeur SQL du projet Supabase (le compte doit déjà exister) :

```sql
select public.admin_designer('adresse@du-compte.fr', 'superadmin');
```

Les suivants se nomment depuis `/admin/reglages`. Aucune adresse d'administrateur n'est écrite dans le code.

## Organisation

- `supabase/migrations` : schéma, règles d'accès, export Collab
- `src` : application React (Vite, TypeScript, Tailwind)
- `e2e` : parcours de bout en bout (Playwright)
- `docs` : cahier des charges, maquettes, schéma, échanges avec Signabail
