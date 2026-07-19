# Mission Control

## Current objective

Clôturer l’Orbite 4 avec un flux SSE rejouable, un snapshot HTTP autoritaire et une interface capable de reprendre après une coupure sans dupliquer les événements.

## Current state

Les Orbites 0 à 4 sont terminées localement. Chaque snapshot de session expose la dernière séquence SQLite durable. L’interface charge ce snapshot avec TanStack Query, ouvre ensuite un `EventSource` et coalesce les événements live en relectures autoritaires. Le transport SSE rejoue le journal après un curseur, accepte `Last-Event-ID`, déduplique par séquence et maintient les runs visuellement séparés.

## Last completed orbit

**Orbite 4 — Ouvrir les signaux vers l’interface.** Le navigateur reçoit les contributions progressivement via `GET /sessions/:sessionId/events`, recharge un snapshot après les signaux, rattrape les événements manqués et conserve la session lors d’un rafraîchissement ou d’un redémarrage du daemon.

## Commands verified

- `rtk proxy pnpm install --offline --store-dir /tmp/naetia-pnpm-store` — lockfile et dépendance workspace UI/protocole résolus sans réseau.
- `rtk proxy pnpm typecheck` — réussi sur les quatre projets applicatifs.
- `rtk proxy pnpm lint` — réussi, zéro warning.
- `rtk proxy pnpm test` — 42 tests réussis sur tout le workspace (29 daemon, 4 UI, 3 domaine, 6 protocole).
- `rtk proxy pnpm build` — réussi sur tout le workspace.
- Tests transport — curseur exclusif, priorité de `Last-Event-ID`, sérialisation SSE, ordre rejouable, isolation d’un listener déconnecté, requêtes invalides et session absente.
- Test UI — ouverture après le snapshot, passage `live → reconnecting → live`, validation Zod et rejet d’un curseur déjà reçu.
- Chromium réel sur `127.0.0.1:5173` — trois PID distincts, deltas progressifs dans trois cartes, aucun message console d’erreur.
- Reprise SSE réelle — `after=1` avec `Last-Event-ID: 28` a renvoyé uniquement `id: 29` au format `council-event`.
- Redémarrage sur la même base — la page rechargée a retrouvé les trois contributions terminées et a remplacé les PID par « Exécution restaurée du journal ».
- Annulation réelle — Guardian est passé à `cancelled` pendant qu’Architect et Trickster restaient `running`.
- Vue responsive vérifiée à `1505×1045` et `390×844`.

## Decisions

- La séquence SQLite est le curseur SSE ; l’UUID événementiel reste l’identité métier.
- Le snapshot expose `eventCursor` et reste la source de vérité de l’interface.
- Le SSE transporte un `CouncilEvent` nu, validé par le protocole, sous le nom `council-event` ; son champ `id` contient la séquence durable.
- Le serveur prend le maximum entre `after` et `Last-Event-ID`.
- Le transport s’abonne avant de lire le backlog, tamponne les nouveaux événements puis trie et déduplique avant le passage en live.
- Une erreur de listener SSE ne remonte jamais dans l’orchestrateur durable.
- L’interface ne maintient pas un second reducer métier : elle coalesce les signaux et recharge le snapshot TanStack Query.
- Le polling à une seconde n’est qu’un filet de sécurité lorsqu’un run est actif et que le flux n’est pas live.

## Known risks

- Un signal live déclenche encore une relecture de snapshot complet. Les rafraîchissements sont coalescés, mais le coût devra être mesuré avant des sessions longues.
- Le contrat de snapshot HTTP reste défini côté daemon et validé côté UI ; seul `CouncilEvent` est actuellement partagé par `assembly-protocol`.
- Les erreurs runtime remontent encore leur message technique en anglais dans les cartes.
- Une erreur SQLite pendant un événement enfant exige un redémarrage du daemon après restauration du stockage ; aucun retry automatique n’est tenté.
- Le worker est construit au démarrage de `pnpm dev`, mais un changement de son source demande une relance.

## Open questions

- Quel plus petit modèle de `Fragment` permet KEEP, CHALLENGE et COMPOST sans introduire une seconde vérité éditoriale ?
- La Forge doit-elle accepter uniquement des fragments conservés, ou toute provenance non compostée ?

## Next orbit

**Orbite 5 — Construire la Porte du Royaume.** Ajouter les fragments, leur disposition humaine, la Forge et le Return Point dans un parcours vertical persistant sans élargir l’infrastructure.
