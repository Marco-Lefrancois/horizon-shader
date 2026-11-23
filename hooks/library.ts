import type { ThemeBackdropGlass, ThemeGround } from 'claude-code'

import type { makeColors } from './make-colors.js'
import { HORIZON_LOOKS } from './horizon.js'

// La librairie de looks : Horizon (horizon.ts). Ajouter un look : une entrée dans LOOKS.
export type Look = {
  title: string
  description: string
  palette: Parameters<typeof makeColors>[0]
  // Une scène (SVG) ; absente, le fond est la couleur de la page.
  scene?: string
  // Ce que dit la scène, pour un lecteur d'écran.
  alt?: string
  glass?: ThemeBackdropGlass | false
  // Un fond fixe (image du dossier du mod, couleur…) à la place d'une scène.
  ground?: ThemeGround
  // Un shader joué sur la scène, qui suit la session (travail du modèle, contexte, rythme) ;
  // la scène SVG reste l'image fixe là où il ne joue pas. Un seul pour l'instant : Horizon.
  shader?: 'horizon'
  // Couleurs de la barre de consommation, en bandes de gauche à droite ; absentes, l'accent.
  bar?: string[]
}

export const LOOKS: Record<string, Look> = { ...HORIZON_LOOKS }

// Un choix retenu qui n'existe plus retombe ici.
export const DEFAULT_LOOK = 'horizon'
