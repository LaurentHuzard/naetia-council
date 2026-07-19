# Naetia Council Roadmap

## Livré — Porte initiale, Orbites 0 à 5

- workspace TypeScript strict et protocoles validés ;
- trois runs agents isolés avec faux modèle déterministe ou Codex CLI ;
- journal SQLite append-only et replay SSE ;
- Loot avec KEEP, CHALLENGE et COMPOST ;
- Forge avec provenance serveur ;
- Return Point restauré après rafraîchissement et redémarrage.

## Maintenant — Orbite 5.1, ouvrir le Port

- exposer un index local minimal des sessions récentes ;
- reprendre une session depuis l'interface ;
- conserver le snapshot SQLite comme autorité ;
- éviter routeur, dashboard et dépendances nouvelles sans besoin observé.

## Ensuite — à décider par preuve

- modéliser un cycle explicite de révision ;
- choisir entre décision liée à la précédente et nouvelle session ;
- améliorer la visibilité de la durée et de la consommation du mode Codex ;
- ne poursuivre le streaming natif que si le CLI expose un flux incrémental
  stable.

Le dispatch, les risques et les preuves à jour sont dans
[`docs/mission-control.md`](docs/mission-control.md).
