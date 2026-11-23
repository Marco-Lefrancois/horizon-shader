import type { Look } from './library.js'

// Horizon : un soleil crème au-dessus d'une plaine marine, sous un ciel brique, en formes plates
// d'esprit sérigraphie rétro. Le SVG est l'image fixe ; là où le moteur joue les shaders,
// horizon-shader.ts la redessine et la fait suivre la session.

type Palette = Look['palette']

const REDUCED = '@media (prefers-reduced-motion: reduce){*{animation:none!important}}'

const open = (bg: string, defs = '', css = ''): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">` +
  `<defs>${defs}</defs><style>${css}${REDUCED}</style>` +
  `<rect width="100%" height="100%" fill="${bg}"/>`

// Bloc du sujet : carré calé en haut à droite.
const corner = (body: string, w = '55%', h = '60%'): string =>
  `<svg x="${100 - parseFloat(w)}%" y="0" width="${w}" height="${h}" viewBox="0 0 400 400" preserveAspectRatio="xMaxYMin meet">${body}</svg>`

// Surfaces et textes d'un look sombre.
const dark = (s: [string, string, string, string], t: [string, string, string]): NonNullable<Palette['dark']> => ({
  gray: {
    anchors: {
      'surface-0': s[0],
      'surface-1': s[1],
      'surface-2': s[2],
      'surface-3': s[3],
      'text-primary': t[0],
      'text-secondary': t[1],
      'text-muted': t[2],
    },
  },
})

// Horizon : soleil crème au-dessus d'une plaine marine en perspective, ciel rouge brique.
const HORIZON =
  open('#b84a3a', '', '.sun{animation:sink 26s ease-in-out infinite alternate}@keyframes sink{to{transform:translateY(6px)}}') +
  `<rect y="62%" width="100%" height="38%" fill="#22264a"/>` +
  corner(`<circle class="sun" cx="250" cy="170" r="48" fill="#efe6d0"/>`, '55%', '62%') +
  `<svg x="0" y="62%" width="100%" height="38%" viewBox="0 0 1000 380" preserveAspectRatio="none"><g stroke="#3a3f6a" stroke-width="2" fill="none">` +
  [0, 1, 2, 3, 4, 5, 6].map(i => `<line x1="${620 + (i - 3) * 6}" y1="0" x2="${620 + (i - 3) * 160}" y2="380"/>`).join('') +
  [12, 30, 56, 92, 140, 200, 280].map(y => `<line x1="0" y1="${y}" x2="1000" y2="${y}"/>`).join('') +
  `</g></svg></svg>`

export const HORIZON_LOOKS: Record<string, Look> = {
  horizon: {
    title: 'Horizon',
    description: 'Soleil crème au-dessus d’une plaine marine en perspective, ciel rouge brique ; suit le travail du modèle, le contexte et le rythme',
    palette: {
      label: 'Horizon',
      id: 'horizon',
      only: 'dark',
      roles: { accent: '#e07a62', danger: '#ef4f4f', success: '#8fc79a', warning: '#e8b45a', pro: '#a99cf0' },
      dark: dark(['#14162b', '#191b33', '#1d2039', '#20233f'], ['#efe6d0', '#cfc6b2', '#a8a08f']),
    },
    scene: HORIZON,
    shader: 'horizon',
    alt: 'Un soleil crème dans un ciel rouge brique au-dessus d’une plaine marine quadrillée',
    glass: { blur: 10, opacity: 0.88 },
  },
}
