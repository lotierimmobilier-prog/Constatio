import { useEffect, useRef, useState } from 'react';

// Carrousel circulaire des écrans de l'application (anneau en 3D qui tourne lentement,
// que l'on peut faire glisser). Adapté du composant « Round Carousel » fourni par Jérôme :
//   * le doigt qui fait défiler la page n'est plus capturé (seul le glissement horizontal tourne l'anneau) ;
//   * l'animation s'arrête hors de l'écran, et ne démarre pas si le visiteur a demandé moins de mouvement ;
//   * chaque écran a un texte de remplacement ; les images ne se chargent qu'à l'approche.
export interface Ecran { src: string; alt: string }

const LARGEUR = 176;
const HAUTEUR = 341;
const ESPACEMENT = 1.6;   // 1 = écrans bord à bord
const VITESSE = 14;       // degrés par seconde
const INCLINAISON = -3;

export function CarrouselEcrans({ ecrans }: { ecrans: Ecran[] }) {
  const cadre = useRef<HTMLDivElement>(null);
  const anneau = useRef<HTMLDivElement>(null);
  const angle = useRef(0);
  const elan = useRef(0);
  const glisse = useRef<{ x: number } | null>(null);
  const [visible, setVisible] = useState(false);
  const pas = 360 / ecrans.length;
  const rayon = (LARGEUR * ESPACEMENT) / (2 * Math.tan(Math.PI / ecrans.length));

  useEffect(() => {
    const o = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '200px' });
    if (cadre.current) o.observe(cadre.current);
    return () => o.disconnect();
  }, []);

  useEffect(() => {
    const a = anneau.current;
    if (!a) return;
    const poser = () => { a.style.transform = `translateZ(${-rayon}px) rotateY(${angle.current}deg)`; };
    poser();
    if (!visible) return;
    const calme = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let image = 0;
    let avant = 0;
    const dessiner = (maintenant: number) => {
      const dt = Math.min(avant ? (maintenant - avant) / 1000 : 0, 0.1);
      avant = maintenant;
      if (!glisse.current) {
        if (Math.abs(elan.current) > 0.01) { angle.current += elan.current * dt; elan.current *= 0.94; }
        else if (!calme) angle.current -= VITESSE * dt;
      }
      poser();
      image = requestAnimationFrame(dessiner);
    };
    image = requestAnimationFrame(dessiner);
    return () => cancelAnimationFrame(image);
  }, [rayon, visible]);

  const tourner = (degres: number) => { elan.current = degres * 4; };

  return (
    <div className="flex flex-col items-center gap-3">
      <div ref={cadre} role="group" aria-roledescription="carrousel" aria-label="Écrans de l’application Constatio"
        className="flex w-full cursor-grab select-none items-center justify-center overflow-hidden py-6 active:cursor-grabbing"
        style={{ perspective: '3000px', touchAction: 'pan-y', height: HAUTEUR + 70 }}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); glisse.current = { x: e.clientX }; elan.current = 0; }}
        onPointerMove={(e) => {
          if (!glisse.current) return;
          const dx = e.clientX - glisse.current.x;
          glisse.current.x = e.clientX;
          angle.current += dx * 0.5;
          elan.current = dx * 30;
        }}
        onPointerUp={() => { glisse.current = null; }} onPointerCancel={() => { glisse.current = null; }}>
        <div style={{ transformStyle: 'preserve-3d', transform: `rotateX(${INCLINAISON}deg)` }}>
          <div ref={anneau} style={{ position: 'relative', width: LARGEUR, height: HAUTEUR, transformStyle: 'preserve-3d' }}>
            {ecrans.map((e, i) => (
              <div key={e.src} style={{ position: 'absolute', inset: 0, transform: `rotateY(${i * pas}deg) translateZ(${rayon}px)`, transformStyle: 'preserve-3d' }}>
                <img src={e.src} alt={e.alt} width={LARGEUR} height={HAUTEUR} loading="lazy" draggable={false}
                  className="absolute inset-0 h-full w-full rounded-[20px] border border-trait bg-surface object-cover object-top shadow-xl" style={{ backfaceVisibility: 'hidden' }} />
                {/* Dos de l'écran, vu à travers l'anneau : la même image, assombrie. */}
                <img src={e.src} alt="" aria-hidden width={LARGEUR} height={HAUTEUR} loading="lazy" draggable={false}
                  className="absolute inset-0 h-full w-full rounded-[20px] object-cover object-top" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)', filter: 'brightness(0.55)' }} />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex gap-3">
        <button type="button" onClick={() => tourner(pas)} aria-label="Écran précédent" className="h-11 w-11 rounded-full border border-trait bg-surface text-lg font-bold text-marque">←</button>
        <button type="button" onClick={() => tourner(-pas)} aria-label="Écran suivant" className="h-11 w-11 rounded-full border border-trait bg-surface text-lg font-bold text-marque">→</button>
      </div>
    </div>
  );
}
