# Mission Control

## Current objective

Préparer **l’Orbite 5.4 — Challenger sans reconvoquer toute l’Assemblée** : transformer CHALLENGE en contrepoint humain ciblé sans perdre l’isolation, la provenance ni la maîtrise des appels modèle.

## Dispatch

- **Navigateur** — vérifier les frontières Codex, worker, journal et snapshot ; résultat attendu : aucun type fournisseur dans le domaine.
- **Ingénieur de The Assembly / Capitaine** — renforcer le prompt de révision et mesurer uniquement l’inférence Codex, hors délai de révélation locale.
- **Pilote d’interface / Capitaine** — valider `modelExecution` à la frontière HTTP puis afficher adaptateur, modèle, durée et quatre compteurs JSONL par carte.
- **Gardien** — prouver trois prompts contenant rôle, D1 et intention, replay des mesures, JSONL invalide, usage absent, annulation et timeout.
- **Trickster technique** — refuser nouvelle table, agrégat de coût inventé, gate lexical sur une réponse réelle et duplication des métriques hors `contribution.completed`.

## Current state

Le mode `codex-cli` est fonctionnel de bout en bout. Une convocation lance trois processus agents distincts et chacun exécute son propre `codex exec` avec la définition versionnée d’Architect, Trickster ou Guardian.

Le parcours Quest → Assembly → Loot → Forge → Return est maintenant implémenté. Chaque contribution terminée produit un fragment durable ; les commandes KEEP, CHALLENGE et COMPOST passent par The Assembly ; la Forge accepte uniquement des fragments conservés et construit leur provenance ; décision et Return Point sont journalisés atomiquement. Le journal append-only reste l’unique stockage, sans migration SQLite ni infrastructure supplémentaire.

Le Port est dérivé directement des projections rejouées. Son résumé ne transporte ni événements, ni contributions, ni fragments : la reprise recharge le snapshot complet avant d’ouvrir le SSE existant. Zustand reste limité à l’identifiant de navigation ; TanStack Query possède l’index serveur. Une session disparue produit une erreur visible et ne pollue pas le stockage local.

Le modèle de révision retenu est une session enfant liée à la décision source. Elle commence en état créé, sans run, et ne convoque le Council qu’après un second geste humain explicite. La session parente ne reçoit aucun événement et reste immuable.

Une révision réelle a maintenant été exécutée avec Codex CLI. Les trois voix citent explicitement D1 et l’intention humaine, proposent chacune un changement cohérent avec leur rôle et exposent dans leur carte la durée d’exécution ainsi que les compteurs entrée, cache, sortie et raisonnement fournis par le JSONL. Ces mesures sont reconstruites depuis `contribution.completed` après redémarrage, sans relancer Codex.

## Last completed orbit

**Orbite 5.3 — Prouver la seconde délibération.** Une fixture traverse fork, IPC, adaptateur Codex JSONL, journal et replay pour prouver que chaque prompt reçoit son rôle, D1 et l’intention humaine. Le parcours réel confirme la pertinence des trois réponses. L’interface valide et affiche les mesures par voix ; la durée exclut le délai artificiel de révélation locale.

## Commands verified

- `rtk run pnpm typecheck` — réussi sur les quatre projets du workspace.
- `rtk pnpm lint` — réussi, zéro warning.
- `rtk pnpm build` — réussi sur les quatre projets du workspace.
- `rtk run pnpm test` — 89 tests réussis : 58 daemon, 11 UI, 4 domaine et 16 protocole.
- Tests de reprise — fragments historiques complétés sans doublon, dispositions, décision, Return Point et provenance identiques après redémarrage.
- Test SQLite verrouillé — ni décision ni Return Point partiel ; la même commande réussit après libération du verrou.
- Playwright + Codex CLI — trois cartes terminées et trois PID distincts ; KEEP, CHALLENGE, COMPOST et Forge exécutés dans Chromium.
- Rafraîchissement navigateur — décision, objection, provenance et prochain geste restaurés depuis le snapshot autoritaire.
- Redémarrage réel — même SQLite, `eventCursor: 53`, Return Point restauré et `GET /health` revenu à `modelAdapter: codex-cli`.
- Console Chromium — zéro erreur et zéro warning avant redémarrage ; affichage mobile sans débordement horizontal (`scrollWidth: 375`, `clientWidth: 375`).
- Index du Port — vide, limite stricte, ordre par activité durable, résumé forgé et replay identique couverts par les tests API et de redémarrage.
- Reprise navigateur — deux sessions réelles au faux modèle, ordre récent correct, aucune création pendant la reprise, Forge et Return Point restaurés, zéro erreur ou warning React.
- Révision navigateur — création enfant sans `/convene`, puis trois nouveaux PID (`138321`, `138322`, `138323`), D2 forgée et D1 rouverte intacte.
- Redémarrage de révision — index JSON strictement identique avant/après avec `revisionOf`, D1 à `eventCursor: 35` et D2 à `eventCursor: 102`.
- Mobile révision — zéro débordement horizontal (`scrollWidth: 390`, `clientWidth: 390`) et console finale sans erreur ni warning.
- Preuve automatisée Codex révision — trois forks et trois sous-processus JSONL reçoivent rôle, statement, rationale, objection, condition de révision, dernier geste et intention exacts ; les mesures sont identiques après replay SQLite.
- Isolation Codex — JSONL Architect invalide et timeout Guardian restent limités à leurs runs ; Trickster termine avec sa contribution et ses mesures.
- Preuve réelle Codex 0.144.6 — trois PID (`172796`, `172797`, `172798`) terminés ; les trois contributions révisent explicitement l’atelier D1 de deux heures et huit personnes vers un micro-test compatible avec trente minutes et trois personnes.
- Mesures réelles — Architect `12 698 ms / 9 933 entrée / 6 912 cache / 313 sortie / 0 raisonnement`, Trickster `9 888 / 9 935 / 6 912 / 276 / 0`, Guardian `13 293 / 9 932 / 6 912 / 332 / 23`.
- Redémarrage Codex — D2 conserve `eventCursor: 80`, les mêmes mesures et les trois contributions ; les PID sont absents et aucun appel n’est relancé. D1 reste à `eventCursor: 35`.
- QA rendue — desktop 1440 px et mobile 390 px sans débordement ; session navigateur propre avec zéro erreur et zéro warning console.

## Decisions

- Le vrai modèle est opt-in avec `MODEL_ADAPTER=codex-cli`; `fake` reste la valeur par défaut et la base des tests réseau-indépendants.
- Une voix correspond à un fork et à une invocation Codex distincte. Aucun appel unique ne simule les trois rôles.
- La définition complète de l’agent traverse l’IPC comme contexte immuable ; le worker ne duplique pas les personas.
- Seul `CODEX_HOME` est transmis au worker et au CLI. Les variables fournisseur du daemon ne traversent pas cette frontière.
- Codex est lancé directement, sans shell, avec `--ephemeral`, `--ignore-user-config`, `--ignore-rules`, `--sandbox read-only`, recherche web désactivée et héritage shell désactivé.
- Le JSONL stable fournit actuellement un message final et non des deltas textuels. The Assembly révèle donc le résultat en fragments post-réponse et documente honnêtement cette limite.
- La durée et l’usage modèle appartiennent à l’événement durable `contribution.completed` afin d’être reconstruits après redémarrage.
- La durée Codex s’arrête à la réception du résultat CLI et exclut les délais locaux utilisés pour révéler la contribution par fragments.
- L’interface affiche les compteurs JSONL séparément. Cache et raisonnement ne sont pas additionnés aux compteurs principaux et aucun coût n’est inventé.
- `modelExecution` est validé et normalisé à la frontière HTTP avant d’entrer dans l’état React ; Zustand ne reçoit aucune télémétrie supplémentaire.
- Une contribution terminée et son `fragment.created` sont ajoutés dans une transaction unique ; aucun fragment n’est créé pour un run échoué ou annulé.
- Les dispositions de fragments suivent une petite machine d’états métier et les rejeux identiques ne déplacent pas le curseur d’événements.
- La provenance de la décision est dérivée côté serveur depuis les fragments et les runs ; l’interface ne peut pas l’inventer.
- `decision.forged` et `return_point.updated` sont atomiques. Une première décision verrouille ses sources pour préserver leur sens lors de la reprise.
- Un fragment correspond à la contribution complète d’un agent pour cette porte. Aucun découpage éditorial ou package supplémentaire n’est introduit avant un besoin observé.
- L’index du Port est une projection du journal, pas un nouveau modèle persistant. Son curseur durable sert au tri et son contrat reste compact.
- Le Port reste visible sans routeur. La sélection est explicite et la navigation est verrouillée pendant les mutations ou les runs actifs.
- Une reprise valide d’abord le snapshot ; l’identifiant local n’est modifié qu’après ce succès.
- Une révision est une nouvelle session liée, pas un second round. `session.created` porte `revisionOf` et aucune migration SQLite n’est nécessaire.
- Une décision possède au plus une révision directe : le retry avec la même intention retrouve l’enfant, une intention concurrente reçoit `REVISION_ALREADY_STARTED`.
- Le contexte des nouveaux agents est dérivé côté Assembly depuis la quête, l’intention, D1 et son Return Point. Le navigateur ne copie jamais la décision source.
- La création et la convocation sont deux gestes humains distincts ; aucun processus ni token n’est consommé par la préparation seule.

## Known risks

- Trois voix consomment trois appels ; le mode réel ne doit pas devenir le défaut de développement.
- La contribution reste vide pendant l’inférence Codex, puis apparaît rapidement en fragments. Un vrai streaming demanderait une sortie CLI textuelle incrémentale stable ou un autre adaptateur.
- Le mode réel dépend de la compatibilité des options du CLI et d’une session locale authentifiée ; les erreurs sont isolées par run mais cette dépendance doit rester visible.
- Codex peut omettre `turn.completed.usage`; l’interface affiche alors explicitement « Usage non fourni » plutôt qu’un zéro trompeur.
- Les tests qui lancent un exécutable enfant nécessitent un environnement autorisant `spawn`; le sandbox restreint de l’agent retourne `EPERM`, alors que la suite hors sandbox et le runtime réel réussissent.
- Le démarrage parallèle de `pnpm dev` peut afficher brièvement The Assembly indisponible pendant que le daemon compile ; la reconnexion reprend ensuite automatiquement.
- CHALLENGE enregistre une disposition durable mais ne relance pas encore l’agent avec une objection humaine.
- Une seule décision immuable reste autorisée par session ; les branches concurrentes de révision sont volontairement refusées.
- Le Port ne présente que les huit sessions les plus récentes, sans pagination, recherche, suppression ni URL partageable.
- Chaque rafale SSE invalide encore le snapshot actif et l’index compact ; ce trafic local reste acceptable pour huit lignes mais devra être mesuré avant d’élargir le Port.
- Les compteurs exposés sont ceux du CLI, pas un coût monétaire ni un budget prédictif. Trois voix consomment toujours trois appels complets.
- Un ancien binaire ne peut pas relire un journal qui contient le nouveau champ strict `revisionOf`.

## Open questions

- CHALLENGE doit-il rappeler uniquement la voix source ou permettre à l’humain de choisir la voix contradictrice ?
- Quel budget humain doit précéder un appel ciblé supplémentaire : confirmation simple, durée maximale ou plafond de tokens ?
- Une future branche concurrente doit-elle être une nouvelle quête ou rester interdite ?

## Next orbit

**Orbite 5.4 — Challenger sans reconvoquer toute l’Assemblée.** Faire d’un CHALLENGE une demande humaine ciblée, lancer au plus une nouvelle voix observable et conserver le fragment initial comme provenance immuable.
