// Aiguilleur des fonctions serveur pour la pile locale (dev/pile-locale.sh) :
// /<nom>/… est confié à la fonction supabase/functions/<nom>. En production,
// c'est Supabase qui joue ce rôle : ce fichier n'y est pas déployé.
// @ts-nocheck
Deno.serve(async (requete: Request) => {
  const nom = new URL(requete.url).pathname.split('/')[1];
  if (!nom || nom.startsWith('_')) return new Response(JSON.stringify({ erreur: 'fonction_inconnue' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  try {
    const travailleur = await EdgeRuntime.userWorkers.create({
      servicePath: `/home/deno/functions/${nom}`, memoryLimitMb: 256, workerTimeoutMs: 60_000, noModuleCache: false,
      envVars: Object.entries(Deno.env.toObject()),
    });
    return await travailleur.fetch(requete);
  } catch (e) {
    console.error(nom, e);
    return new Response(JSON.stringify({ erreur: 'fonction_en_echec', detail: String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
