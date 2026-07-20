# Naetia Council Roadmap

## Livré — Porte initiale, Orbites 0 à 5.2

- workspace TypeScript strict et protocoles validés ;
- trois runs agents isolés avec faux modèle déterministe ou Codex CLI ;
- journal SQLite append-only et replay SSE ;
- Loot avec KEEP, CHALLENGE et COMPOST ;
- Forge avec provenance serveur ;
- Return Point restauré après rafraîchissement et redémarrage.
- Port compact des sessions récentes et reprise explicite d’une ancienne quête.
- session de révision liée, décision source immuable et nouvelle convocation explicite.

## Maintenant — prouver la révision avec Codex CLI

- vérifier que l’intention et D1 atteignent bien chaque nouvelle voix ;
- comparer D1 et D2 sans réduire leurs provenances à un transcript ;
- rendre durée et consommation visibles par nouvelle délibération ;
- garder le faux modèle comme chemin de test par défaut.

## Ensuite — à décider par preuve

- améliorer la visibilité de la durée et de la consommation du mode Codex ;
- ne poursuivre le streaming natif que si le CLI expose un flux incrémental
  stable.

Le dispatch, les risques et les preuves à jour sont dans
[`docs/mission-control.md`](docs/mission-control.md).
