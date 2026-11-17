/** @type {import('tailwindcss').Config} */
const v = (nom) => `rgb(var(--${nom}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        fond: v('fond'), surface: v('surface'), creux: v('creux'), encre: v('encre'),
        discret: v('discret'), trait: v('trait'), marque: v('marque'), 'sur-marque': v('sur-marque'),
        repere: v('repere'), 'sur-repere': v('sur-repere'),
        neuf: v('neuf'), bon: v('bon'), usage: v('usage'), mauvais: v('mauvais'), hs: v('hs'),
      },
      fontFamily: {
        titre: ['"Bricolage Grotesque Variable"', 'Inter Variable', 'system-ui', 'sans-serif'],
        sans: ['"Inter Variable"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
