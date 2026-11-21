// Sonde : répond si les fonctions serveur tournent. Aucune donnée.
Deno.serve(() => new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } }));
