// Contrat d'état du mod horizon-shader : ce que la bande de consommation lit en dessinant.
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

// État de la session que lit le shader d'Horizon (vivant.ts), chaque valeur de 0 à 1 sauf aides (0 à 4).
// Le rythme n'y est pas : il se calcule au dessin depuis les limites de la bande.
export type Etat = {
  contexte: number
  travail: number
  attente: number
  aides: number
  outils: number
  ennui: number
}

declare module 'claude-code' {
  interface PluginState {
    'horizon-shader': {
      limits: Limit[]
      now: number
      look: string
      vivant: Shaped<Etat>
    }
  }
}
