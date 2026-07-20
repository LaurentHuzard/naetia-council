# Mission Control

## Current objective

Préparer **l’Orbite 5.5 — Full Council en cercles** : limiter la concurrence,
faire intervenir les neuf membres en vagues lisibles et transmettre aux
contrepoints uniquement le contexte utile des voix précédentes.

## Dispatch

- **Navigateur** — protéger la distinction entre catalogue, délégation durable
  et runs éphémères ; refuser une nouvelle table de délégation sans besoin.
- **Ingénieur de The Assembly / Capitaine** — concevoir une file locale
  reconstructible et une limite de concurrence sans Redis ni processus permanent.
- **Officier des Signaux** — rendre les phases visibles dans le snapshot et le
  SSE sans faire du transport la source de vérité.
- **Pilote d’interface** — montrer first voices, counterpoints, evidence and
  memory sans neuf murs de texte simultanés.
- **Gardien** — interrompre un run, le daemon ou SQLite au milieu d’un cercle et
  prouver une reprise honnête.
- **Trickster technique** — vérifier qu’un simple plafond de concurrence ne
  suffit pas avant d’ajouter `CouncilRound` ou une abstraction de workflow.

## Current state

Le parcours Port → Quest → Chamber → Delegation → Assembly → Loot → Forge →
Return est fonctionnel en local. La préparation d’une quête et sa convocation
sont désormais deux gestes distincts : aucun processus ni appel modèle ne part
avant la confirmation de la délégation.

Le Council permanent contient neuf définitions versionnées dans
`@naetia/agent-definitions`. The Assembly recommande de trois à quatre membres
avec une règle locale explicable selon la quête ; l’humain peut modifier la
sélection ou choisir le Full Council.

`session.convened` reste le snapshot durable de la délégation. Seules les
définitions choisies sont journalisées et chacune produit exactement un run et
un processus enfant. Un retry du même ensemble, quel que soit son ordre, est
idempotent ; une sélection concurrente est refusée.

Le snapshot HTTP expose les définitions journalisées. Les cartes, fragments,
sources de Forge et Return utilisent donc l’identité historique réellement
convoquée, pas le catalogue courant. Le replay SQLite restaure la même
délégation sans PID et sans relancer de modèle.

Le faux modèle n’a plus de table fermée à trois rôles. Codex CLI demeure un
adaptateur partagé : une voix sélectionnée correspond toujours à un fork et à
une invocation distincte.

## Last completed orbit

**Orbite 5.4 — Toute la Chambre, seulement les bonnes voix.** La Chambre montre
Architect, Builder, Trickster, Guardian, Archivist, Game Designer, LLM Genie,
Inner Child et Scout. Une recommandation peut être modifiée, seuls les membres
confirmés créent des runs, et leurs définitions versionnées survivent au replay.

## Commands verified

- `rtk proxy pnpm install --no-frozen-lockfile` — workspace à six projets relié,
  sans nouvelle dépendance produit externe.
- `rtk proxy pnpm typecheck` — réussi sur les cinq projets exécutables du workspace.
- `rtk proxy pnpm lint` — réussi, zéro warning.
- `rtk proxy pnpm test` — 98 tests réussis : 4 domaine, 17 protocole,
  2 registre, 63 daemon et 12 UI.
- `rtk proxy pnpm build` — réussi sur les cinq projets exécutables du workspace.
- Tests domaine et protocole — neuf rôles, sélection stricte de 1 à 9,
  doublons et rôles inconnus refusés.
- Test registre — neuf définitions uniques, complètes et résolues dans l’ordre canonique.
- Test processus — Architect + Scout créent deux PID, deux contributions et deux
  fragments ; aucun run Guardian.
- Test idempotence — même ensemble dans un autre ordre sans nouvel événement ;
  autre sélection refusée.
- Test API — Full Council produit neuf runs et neuf définitions distinctes.
- Test React — neuf membres visibles avant la quête, recommandation modifiable et
  body exact `architect · guardian · scout`.
- Test replay — sélection et définitions versionnées identiques après redémarrage,
  PID absents et aucun appel relancé.

## Decisions

- Le contexte ChatGPT fourni le 20 juillet 2026 devient la fondation produit
  canonique, résumée dans `docs/product-foundation.md`.
- Présence, convocation et exécution restent trois notions distinctes.
- La délégation n’est ni une table ni une nouvelle entité persistante :
  `session.convened.agentDefinitions` porte déjà la preuve utile.
- Le registre partagé est une vraie frontière métier ; il ne connaît ni React,
  Fastify, SQLite, Codex ni Docker.
- L’API accepte de un à neuf rôles distincts et les résout dans l’ordre canonique.
- Un body absent conserve Architect, Trickster et Guardian pour les anciens clients.
- Une nouvelle UI prépare la quête, affiche la recommandation, puis envoie
  toujours une sélection explicite.
- Le Full Council n’est pas un mode métier séparé : c’est la sélection des neuf
  membres. Sa chorégraphie reste une responsabilité de runtime.
- Une révision redemande une sélection ; elle n’hérite jamais silencieusement de
  la délégation source.
- Docker reste exclu du développement initial. Un smoke test de distribution
  ne vient qu’après la chorégraphie, le Duel et l’export.

## Known risks

- Le bouton Full Council lance actuellement neuf runs en parallèle. La sélection
  est réelle, mais le mode n’est pas considéré terminé avant l’Orbite 5.5.
- Une recommandation est déterministe et locale ; sa pertinence produit doit être
  évaluée avant toute sélection par LLM.
- Le brouillon de sélection n’est pas persisté avant la convocation. Un
  rafraîchissement restaure la recommandation, pas les modifications non confirmées.
- Un ancien binaire ne peut pas relire un événement contenant un rôle ajouté ;
  le downgrade n’est pas supporté après la première nouvelle voix.
- Codex consomme un appel par voix et reste explicitement opt-in.
- CHALLENGE conserve une disposition durable mais ne lance pas encore de Duel ciblé.
- La contribution Codex reste une révélation locale post-réponse, pas un flux de
  tokens natif.

## Open questions

- La limite initiale doit-elle être de deux, trois ou quatre runs concurrents ?
- Les contrepoints doivent-ils recevoir les contributions complètes ou seulement
  les fragments sélectionnés par l’humain ?
- Scout doit-il pouvoir déclarer « aucune recherche requise » sans modèle ?
- Archivist doit-il intervenir automatiquement après la Forge ou rester une voix
  explicitement convoquée ?

## Next orbit

**Orbite 5.5 — Full Council en cercles.** Exécuter les neuf membres avec une
concurrence bornée, des phases observables, un contexte progressif et une reprise
SQLite sans relance des runs déjà terminés.
