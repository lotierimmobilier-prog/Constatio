import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { Logo, classesBouton } from './components/ui';
import { configure } from './lib/supabase';
import { Assistant } from './components/Assistant';
import { CoquilleApp } from './components/CoquilleApp';
import { Accueil } from './pages/Accueil';
import { Connexion } from './pages/Connexion';
import { Inscription } from './pages/Inscription';
import { MotDePasseOublie } from './pages/MotDePasseOublie';
import { NouveauMotDePasse } from './pages/NouveauMotDePasse';
import { Cgv, Confidentialite, MentionsLegales } from './pages/Legal';
import { Passage } from './pages/Passage';
import { Rejoindre } from './pages/Rejoindre';
import { Reserves } from './pages/Reserves';
import { Signer } from './pages/Signer';
import { CoquilleAdmin } from './pages/admin/CoquilleAdmin';
import { AdminAccueil } from './pages/admin/AdminAccueil';
import { AdminCompte, AdminComptes } from './pages/admin/AdminComptes';
import { AdminTarifs } from './pages/admin/AdminTarifs';
import { AdminSignabail } from './pages/admin/AdminSignabail';
import { AdminJournal } from './pages/admin/AdminJournal';
import { AdminReglages } from './pages/admin/AdminReglages';
import { TableauDeBord } from './pages/app/TableauDeBord';
import { Compte } from './pages/app/Compte';
import { Credits } from './pages/app/Credits';
import { NouvelEdl } from './pages/app/NouvelEdl';
import { Edl } from './pages/app/Edl';
import { EdlParties } from './pages/app/EdlParties';
import { EdlPiece } from './pages/app/EdlPiece';
import { EdlCompteurs } from './pages/app/EdlCompteurs';
import { EdlCles } from './pages/app/EdlCles';
import { EdlInventaire } from './pages/app/EdlInventaire';
import { EdlApercu } from './pages/app/EdlApercu';
import { EdlDecompte } from './pages/app/EdlDecompte';
import { EdlControles } from './pages/app/EdlControles';

/** Site publié avant l'ouverture du service : on le dit, plutôt que de proposer une inscription qui échouerait. */
function Ouverture() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <Logo />
      <h1 className="text-2xl font-bold">Ouverture prochaine</h1>
      <p className="text-discret">L’espace client de Constatio n’est pas encore en service. Les inscriptions ouvriront très bientôt.</p>
      <Link to="/" className={classesBouton('plein')}>Revenir à l’accueil</Link>
    </main>
  );
}

export function App() {
  if (!configure) {
    return (
      <>
      <Assistant />
      <Routes>
        <Route path="/" element={<Accueil />} />
        <Route path="/mentions-legales" element={<MentionsLegales />} />
        <Route path="/cgv" element={<Cgv />} />
        <Route path="/confidentialite" element={<Confidentialite />} />
        <Route path="*" element={<Ouverture />} />
      </Routes>
      </>
    );
  }
  return (
    <>
    <Assistant />
    <Routes>
      <Route path="/" element={<Accueil />} />
      <Route path="/mentions-legales" element={<MentionsLegales />} />
      <Route path="/cgv" element={<Cgv />} />
      <Route path="/confidentialite" element={<Confidentialite />} />
      <Route path="/connexion" element={<Connexion />} />
      <Route path="/inscription" element={<Inscription />} />
      <Route path="/mot-de-passe-oublie" element={<MotDePasseOublie />} />
      <Route path="/nouveau-mot-de-passe" element={<NouveauMotDePasse />} />
      <Route path="/passage" element={<Passage />} />
      <Route path="/signer/:jeton" element={<Signer />} />
      <Route path="/rejoindre/:jeton" element={<Rejoindre />} />
      <Route path="/reserves/:jeton" element={<Reserves />} />
      <Route path="/app" element={<CoquilleApp />}>
        <Route index element={<TableauDeBord />} />
        <Route path="compte" element={<Compte />} />
        <Route path="credits" element={<Credits />} />
        <Route path="edl/nouveau" element={<NouvelEdl />} />
        <Route path="edl/:id" element={<Edl />} />
        <Route path="edl/:id/parties" element={<EdlParties />} />
        <Route path="edl/:id/pieces/:pieceId" element={<EdlPiece />} />
        <Route path="edl/:id/compteurs" element={<EdlCompteurs />} />
        <Route path="edl/:id/cles" element={<EdlCles />} />
        <Route path="edl/:id/inventaire" element={<EdlInventaire />} />
        <Route path="edl/:id/controles" element={<EdlControles />} />
        <Route path="edl/:id/apercu" element={<EdlApercu />} />
        <Route path="edl/:id/decompte" element={<EdlDecompte />} />
      </Route>
      <Route path="/admin" element={<CoquilleAdmin />}>
        <Route index element={<AdminAccueil />} />
        <Route path="comptes" element={<AdminComptes />} />
        <Route path="comptes/:id" element={<AdminCompte />} />
        <Route path="tarifs" element={<AdminTarifs />} />
        <Route path="signabail" element={<AdminSignabail />} />
        <Route path="journal" element={<AdminJournal />} />
        <Route path="reglages" element={<AdminReglages />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  );
}
