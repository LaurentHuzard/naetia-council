# Naetia Council Roadmap

## Livré — Porte initiale, Orbites 0 à 5.3

- workspace TypeScript strict et protocoles validés ;
- trois runs agents isolés avec faux modèle déterministe ou Codex CLI ;
- journal SQLite append-only et replay SSE ;
- Loot avec KEEP, CHALLENGE et COMPOST ;
- Forge avec provenance serveur ;
- Return Point restauré après rafraîchissement et redémarrage.
- Port compact des sessions récentes et reprise explicite d’une ancienne quête.
- session de révision liée, décision source immuable et nouvelle convocation explicite.
- seconde délibération réelle avec D1 et intention présentes dans trois prompts Codex distincts.
- durée et compteurs JSONL par voix, validés côté client et restaurés après redémarrage.

## Maintenant — challenger une voix sans alourdir la quête

- transformer CHALLENGE en demande humaine explicite ;
- lancer au plus une voix ciblée et observable ;
- conserver le fragment initial et rattacher le contrepoint à sa provenance ;
- afficher l’appel supplémentaire avant de consommer des tokens.

## Ensuite — à décider par preuve

- décider si une convocation réelle a besoin d’un plafond de durée ou de tokens ;
- ne poursuivre le streaming natif que si le CLI expose un flux incrémental
  stable.

Le dispatch, les risques et les preuves à jour sont dans
[`docs/mission-control.md`](docs/mission-control.md).
