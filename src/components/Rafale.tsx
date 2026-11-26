import { useEffect, useRef, useState } from 'react';

/**
 * Prise de vue en rafale : l'appareil photo reste ouvert, chaque appui prend une photo
 * et l'enregistre aussitôt (sur l'appareil d'abord, comme toute la visite). On enchaîne
 * sans repasser par l'écran, puis « Terminé ».
 */
export function Rafale({ titre, onPhoto, onFermer }: { titre: string; onPhoto: (fichier: File) => Promise<void>; onFermer: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const flux = useRef<MediaStream | null>(null);
  const [pret, setPret] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [prises, setPrises] = useState(0);
  const [enCours, setEnCours] = useState(0);
  const [eclair, setEclair] = useState(false);

  useEffect(() => {
    let actif = true;
    if (!navigator.mediaDevices?.getUserMedia) { setErreur('Cet appareil ne permet pas la prise de vue ici. Fermez, puis utilisez « Choisir dans la galerie ».'); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      .then((s) => {
        if (!actif) { s.getTracks().forEach((t) => t.stop()); return; }
        flux.current = s;
        if (video.current) { video.current.srcObject = s; void video.current.play().then(() => setPret(true)).catch(() => setPret(true)); }
      })
      .catch(() => setErreur('L’appareil photo n’est pas accessible. Autorisez-le pour ce site dans les réglages du navigateur, ou fermez et utilisez « Choisir dans la galerie ».'));
    return () => { actif = false; flux.current?.getTracks().forEach((t) => t.stop()); };
  }, []);

  function prendre() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const toile = document.createElement('canvas');
    toile.width = v.videoWidth; toile.height = v.videoHeight;
    toile.getContext('2d')!.drawImage(v, 0, 0);
    setEclair(true); setTimeout(() => setEclair(false), 120);
    setEnCours((n) => n + 1);
    toile.toBlob((b) => {
      if (!b) { setEnCours((n) => n - 1); return; }
      // Enregistrée sans attendre : on peut déjà viser la suivante.
      void onPhoto(new File([b], `rafale-${Date.now()}.jpg`, { type: 'image/jpeg' })).then(() => setPrises((n) => n + 1)).finally(() => setEnCours((n) => n - 1));
    }, 'image/jpeg', 0.92);
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Photos en rafale" className="fixed inset-0 z-40 flex flex-col bg-black text-white" data-testid="rafale">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <p className="min-w-0 text-sm"><span className="block font-semibold">{titre}</span><span className="block opacity-80" data-testid="rafale-compte">{prises} photo{prises > 1 ? 's' : ''} enregistrée{prises > 1 ? 's' : ''}{enCours > 0 ? ' · enregistrement…' : ''}</span></p>
        <button type="button" onClick={onFermer} className="min-h-[44px] rounded-xl border-2 border-white px-4 font-semibold" data-testid="rafale-fin">Terminé</button>
      </div>
      <div className="relative min-h-0 flex-1">
        <video ref={video} playsInline muted className="absolute inset-0 h-full w-full object-contain" />
        {eclair && <div className="absolute inset-0 bg-white/70" />}
        {erreur && <p className="absolute inset-0 grid place-items-center p-6 text-center">{erreur}</p>}
      </div>
      <div className="flex flex-col items-center gap-2 px-4 py-4">
        <button type="button" onClick={prendre} disabled={!pret || !!erreur} aria-label="Prendre une photo" data-testid="rafale-prendre"
          className="h-20 w-20 rounded-full border-4 border-white bg-white/25 active:bg-white disabled:opacity-40" />
        <p className="text-sm opacity-80">Chaque appui prend une photo et l’enregistre.</p>
      </div>
    </div>
  );
}
