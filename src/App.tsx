import { Navigate, Route, Routes } from 'react-router-dom';
import { CoquilleApp } from './components/CoquilleApp';
import { Accueil } from './pages/Accueil';
import { Connexion } from './pages/Connexion';
import { Inscription } from './pages/Inscription';
import { MotDePasseOublie } from './pages/MotDePasseOublie';
import { NouveauMotDePasse } from './pages/NouveauMotDePasse';
import { TableauDeBord } from './pages/app/TableauDeBord';
import { Compte } from './pages/app/Compte';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Accueil />} />
      <Route path="/connexion" element={<Connexion />} />
      <Route path="/inscription" element={<Inscription />} />
      <Route path="/mot-de-passe-oublie" element={<MotDePasseOublie />} />
      <Route path="/nouveau-mot-de-passe" element={<NouveauMotDePasse />} />
      <Route path="/app" element={<CoquilleApp />}>
        <Route index element={<TableauDeBord />} />
        <Route path="compte" element={<Compte />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
