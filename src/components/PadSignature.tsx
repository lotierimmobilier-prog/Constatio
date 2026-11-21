import { useEffect, useRef, useState } from 'react';
import { Bouton } from './ui';

/** Longueur minimale du tracé, en pixels du dessin : un simple point n'est pas une signature. */
const TRACE_MIN = 120;

/** Zone où l'on signe au doigt ou au stylet. Rend le tracé en PNG (fond transparent). */
export function PadSignature({ occupe, onValider, onAnnuler }: { occupe: boolean; onValider: (png: string) => void; onAnnuler?: () => void }) {
  const toile = useRef<HTMLCanvasElement>(null);
  const dernier = useRef<{ x: number; y: number } | null>(null);
  const [longueur, setLongueur] = useState(0);

  useEffect(() => {
    const c = toile.current!;
    const g = c.getContext('2d')!;
    g.lineWidth = 3.2; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#0f2e2e';
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = toile.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height };
  };
  const debut = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dernier.current = point(e);
  };
  const trace = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dernier.current) return;
    const p = point(e);
    const g = toile.current!.getContext('2d')!;
    g.beginPath(); g.moveTo(dernier.current.x, dernier.current.y); g.lineTo(p.x, p.y); g.stroke();
    const d = Math.hypot(p.x - dernier.current.x, p.y - dernier.current.y);
    dernier.current = p;
    setLongueur((l) => l + d);
  };
  const fin = () => { dernier.current = null; };
  const effacer = () => {
    const c = toile.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setLongueur(0);
  };

  return (
    <div className="flex flex-col gap-2">
      <canvas ref={toile} width={900} height={330} role="img" aria-label="Zone de signature" data-testid="pad"
        className="w-full touch-none rounded-xl border-2 border-dashed border-trait bg-white" style={{ aspectRatio: '900 / 330' }}
        onPointerDown={debut} onPointerMove={trace} onPointerUp={fin} onPointerCancel={fin} />
      <p className="text-center text-sm text-discret">Signez dans le cadre, au doigt ou au stylet.</p>
      <div className="grid grid-cols-2 gap-3">
        <Bouton variante="contour" onClick={longueur > 0 || !onAnnuler ? effacer : onAnnuler} disabled={occupe}>{longueur > 0 || !onAnnuler ? 'Effacer' : 'Annuler'}</Bouton>
        <Bouton disabled={occupe || longueur < TRACE_MIN} onClick={() => onValider(toile.current!.toDataURL('image/png'))} data-testid="valider-signature">{occupe ? 'Enregistrement…' : 'Valider la signature'}</Bouton>
      </div>
    </div>
  );
}
