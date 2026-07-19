# Mission Control

## Current objective

Clôturer l’Orbite 3 avec un journal SQLite à écriture unique, des snapshots reconstruits après redémarrage et des runs interrompus conservés dans un état terminal explicite.

## Current state

Les Orbites 0 à 3 sont terminées localement. The Assembly écrit chaque `CouncilEvent` dans SQLite avant de l’appliquer à sa projection mémoire. Une nouvelle instance du daemon relit le journal, retrouve les quêtes, définitions versionnées, runs, événements et contributions, puis ferme sans relance automatique les runs restés non terminaux.

## Last completed orbit

**Orbite 3 — Journaliser et reconstruire.** Une session terminée a été créée avec trois processus réels, le daemon a été arrêté puis relancé sur le même fichier SQLite, et `GET /sessions/:sessionId` a restitué les mêmes runs et contributions.

## Commands verified

- `rtk proxy pnpm typecheck` — réussi sur les quatre projets applicatifs.
- `rtk proxy pnpm lint` — réussi, zéro warning.
- `rtk proxy pnpm test` — réussi, 36 tests uniques.
- `rtk proxy pnpm build` — réussi sur tout le workspace.
- `rtk proxy pnpm --filter @naetia/assemblyd test` — 24 tests réussis, dont reprise, déduplication, collision transactionnelle, journal corrompu, propriété exclusive, chemin stable, panne SQLite en streaming et interruption pendant arrêt.
- Démarrage réel sur `127.0.0.1:4328` avec une base temporaire — trois PID distincts (`109826`, `109827`, `109828`), 29 événements et trois contributions terminées.
- Deuxième daemon sur la même base — refusé avant réconciliation avec `PERSISTENCE_UNAVAILABLE`.
- Redémarrage sur la même base — HTTP `200`, même `sessionId`, mêmes tailles de contribution et 29 événements ; aucun PID périmé exposé.

## Decisions

- Un seul journal append-only remplace une combinaison prématurée journal + tables de projection.
- Le journal est la source de vérité ; la mémoire n’est qu’une projection reconstruite.
- Les événements IPC sont normalisés en `CouncilEvent` avant écriture.
- `session.convened` conserve les trois définitions d’agents complètes et versionnées.
- La préparation des trois runs est transactionnelle et précède les forks.
- Un événement identique est ignoré ; un même identifiant avec un contenu différent est refusé.
- Les runs interrompus deviennent `failed / DAEMON_RESTARTED` et ne sont pas relancés.
- Les PID restaurés ne sont pas présentés comme des processus vivants.
- Un verrou de propriété empêche deux daemons actifs de modifier le même journal.
- Une panne SQLite asynchrone place le daemon en état dégradé visible au lieu de servir une projection divergente.

## Known risks

- La reconstruction rejoue tout le journal au démarrage ; c’est acceptable pour le volume local initial, mais devra être mesuré avant une éventuelle projection persistée.
- Le flux live reste du polling HTTP jusqu’à l’Orbite 4.
- Une erreur SQLite pendant un événement enfant exige un redémarrage du daemon après restauration du stockage ; aucun retry automatique n’est encore tenté.
- Le worker est construit au démarrage de `pnpm dev`, mais un changement de son source demande une relance.

## Open questions

- Quel curseur SSE minimal doit exposer la séquence SQLite sans dupliquer les événements après reconnexion ?
- Le snapshot HTTP doit-il migrer dans `assembly-protocol` avant l’ouverture du flux SSE ?

## Next orbit

**Orbite 4 — Ouvrir les signaux vers l’interface.** Exposer le journal en SSE avec reprise par séquence, recharger d’abord un snapshot autoritaire et prouver la reconnexion sans doublons.
