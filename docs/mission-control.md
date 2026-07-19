# Mission Control

## Current objective

Clôturer les Orbites 0 à 2 avec un workspace exécutable, un langage métier validé et trois runs agents réellement forkés, progressifs et annulables séparément.

## Current state

Les Orbites 0 à 2 sont terminées. Le dépôt initial ne contenait que `LICENSE`; il contient maintenant cinq projets workspace (racine incluse), une interface React/Vite, The Assembly en Fastify, deux packages métier/protocole et un runtime forké. Le parcours navigateur crée une session, affiche trois PID distincts, reçoit les contributions séparément, annule un seul agent et retrouve le snapshot après rafraîchissement tant que le daemon reste actif.

## Last completed orbit

**Orbite 2 — Faire apparaître trois voix réelles.** Architect, Trickster et Guardian utilisent le même `FakeModelAdapter`, mais possèdent chacun un processus, un statut, une contribution et une annulation indépendants.

## Commands verified

- `rtk proxy pnpm install --offline --frozen-lockfile --store-dir /tmp/naetia-pnpm-store` — réussi, lockfile à jour.
- `rtk proxy pnpm typecheck` — réussi sur les quatre packages applicatifs.
- `rtk proxy pnpm lint` — réussi, zéro warning.
- `rtk proxy pnpm test` — réussi, 24 tests uniques : domaine 3, protocole 6, UI 3, Assembly 12.
- `rtk proxy pnpm build` — réussi sur l’ensemble du workspace.
- `rtk pnpm dev` — réussi après suppression de `apps/assemblyd/dist`, preuve du démarrage depuis un état sans worker précompilé.
- Playwright sur `http://127.0.0.1:5173` — trois PID distincts (`42630`, `42631`, `42632`), Guardian annulé seul, session restaurée après reload, console `0 error / 0 warning`.
- Vue mobile `390 × 844` — largeur document `390`, aucun débordement horizontal.

## Decisions

- Les Orbites 0 à 2 forment une seule tranche d’expédition, vérifiée à chaque frontière.
- Les sessions restent en mémoire jusqu’à l’Orbite 3 ; aucune fausse persistance n’est introduite.
- Le transport HTTP minimal sert la démonstration ; SSE attend l’Orbite 4.
- Chaque run possède son propre processus enfant et ne connaît ni HTTP ni stockage.
- Le `FakeModelAdapter` est le mode par défaut et ne nécessite aucun secret.
- Les forks reçoivent un environnement explicitement réduit ; les clés futures restent dans The Assembly.
- Le navigateur conserve seulement un identifiant local versionné ; le snapshot serveur reste autoritaire.
- Les événements IPC dupliqués sont ignorés par identifiant ; les transitions, index de delta et contenus vides sont refusés.

## Known risks

- La version locale de Node (`v26`) est plus récente que le minimum LTS ciblé ; les builds doivent rester compatibles avec Node 24+.
- L’absence de SQLite signifie qu’un redémarrage perd encore les sessions.
- Le contrat HTTP de snapshot et les commandes génériques de `assembly-protocol` se recouvrent sans être encore une frontière unique.
- Une convocation n’est pas encore atomique si un `fork` échoue au milieu des trois spawns.
- Le worker est construit au démarrage de `pnpm dev`, mais un changement de son source demande une relance pour régénérer le fichier forké.

## Open questions

- Quelle forme minimale de journal événementiel SQLite permet la reconstruction sans dupliquer l’état ?
- Quel contrat de reprise SSE préservera l’ordre et l’idempotence à l’Orbite 4 ?
- Faut-il transporter directement les commandes du protocole en HTTP ou définir un schéma de snapshot dédié et partagé par l’UI ?

## Next orbit

**Orbite 3 — Journaliser et reconstruire.** Introduire SQLite comme journal à écriture unique, rendre la convocation récupérable après crash et reconstruire la session après redémarrage du daemon.
