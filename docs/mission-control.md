# Mission Control

## Current objective

**Stabiliser la Porte ouverte.** Le parcours vertical est livré ; la prochaine incertitude est la reprise multi-session depuis un Port minimal, sans alourdir la Forge ni introduire une seconde source de vérité.

## Dispatch

- **Navigateur** — lecture du domaine, du protocole, du journal et des invariants de replay ; preuve attendue : carte exacte des projections et transitions minimales.
- **Ingénieur de The Assembly / Capitaine** — `assembly-protocol`, orchestrateur, API et tests daemon ; preuve attendue : événements atomiques, commandes validées et reconstruction SQLite.
- **Pilote d’interface / Capitaine** — API cliente, mutations TanStack, composants Loot, Forge et Return, puis styles ; dépendance : snapshot serveur stabilisé.
- **Gardien** — matrice d’échec, tests du parcours critique et reprise ; preuve attendue : doublons, transitions invalides, provenance et redémarrage couverts.
- **Trickster technique** — challenger l’UX et retirer tout état ou endpoint non indispensable.

## Current state

Le mode `codex-cli` est fonctionnel de bout en bout. Une convocation lance trois processus agents distincts et chacun exécute son propre `codex exec` avec la définition versionnée d’Architect, Trickster ou Guardian.

Le parcours Quest → Assembly → Loot → Forge → Return est maintenant implémenté. Chaque contribution terminée produit un fragment durable ; les commandes KEEP, CHALLENGE et COMPOST passent par The Assembly ; la Forge accepte uniquement des fragments conservés et construit leur provenance ; décision et Return Point sont journalisés atomiquement. Le journal append-only reste l’unique stockage, sans migration SQLite ni infrastructure supplémentaire.

## Last completed orbit

**Orbite 5 — Construire la Porte du Royaume.** La session navigateur réelle `f1ef3da4-98b8-4a25-84b7-66f4b81f3670` a lancé trois appels Codex CLI dans trois processus distincts (`387611`, `387613`, `387614`). Les trois contributions ont produit trois fragments. Trickster a été challengé, Architect conservé et Guardian composté. Une décision a ensuite été forgée depuis Architect avec objection, condition de révision, prochain petit geste et provenance. Après rafraîchissement puis redémarrage complet du daemon sur le même SQLite, le Return Point a été reconstruit sans relancer les agents.

## Commands verified

- `rtk run pnpm typecheck` — réussi sur les quatre projets du workspace.
- `rtk pnpm lint` — réussi, zéro warning.
- `rtk pnpm build` — réussi sur les quatre projets du workspace.
- `rtk run pnpm test` — 68 tests réussis : 49 daemon, 5 UI, 4 domaine et 10 protocole.
- Tests de reprise — fragments historiques complétés sans doublon, dispositions, décision, Return Point et provenance identiques après redémarrage.
- Test SQLite verrouillé — ni décision ni Return Point partiel ; la même commande réussit après libération du verrou.
- Playwright + Codex CLI — trois cartes terminées et trois PID distincts ; KEEP, CHALLENGE, COMPOST et Forge exécutés dans Chromium.
- Rafraîchissement navigateur — décision, objection, provenance et prochain geste restaurés depuis le snapshot autoritaire.
- Redémarrage réel — même SQLite, `eventCursor: 53`, Return Point restauré et `GET /health` revenu à `modelAdapter: codex-cli`.
- Console Chromium — zéro erreur et zéro warning avant redémarrage ; affichage mobile sans débordement horizontal (`scrollWidth: 375`, `clientWidth: 375`).

## Decisions

- Le vrai modèle est opt-in avec `MODEL_ADAPTER=codex-cli`; `fake` reste la valeur par défaut et la base des tests réseau-indépendants.
- Une voix correspond à un fork et à une invocation Codex distincte. Aucun appel unique ne simule les trois rôles.
- La définition complète de l’agent traverse l’IPC comme contexte immuable ; le worker ne duplique pas les personas.
- Seul `CODEX_HOME` est transmis au worker et au CLI. Les variables fournisseur du daemon ne traversent pas cette frontière.
- Codex est lancé directement, sans shell, avec `--ephemeral`, `--ignore-user-config`, `--ignore-rules`, `--sandbox read-only`, recherche web désactivée et héritage shell désactivé.
- Le JSONL stable fournit actuellement un message final et non des deltas textuels. The Assembly révèle donc le résultat en fragments post-réponse et documente honnêtement cette limite.
- La durée et l’usage modèle appartiennent à l’événement durable `contribution.completed` afin d’être reconstruits après redémarrage.
- Une contribution terminée et son `fragment.created` sont ajoutés dans une transaction unique ; aucun fragment n’est créé pour un run échoué ou annulé.
- Les dispositions de fragments suivent une petite machine d’états métier et les rejeux identiques ne déplacent pas le curseur d’événements.
- La provenance de la décision est dérivée côté serveur depuis les fragments et les runs ; l’interface ne peut pas l’inventer.
- `decision.forged` et `return_point.updated` sont atomiques. Une première décision verrouille ses sources pour préserver leur sens lors de la reprise.
- Un fragment correspond à la contribution complète d’un agent pour cette porte. Aucun découpage éditorial ou package supplémentaire n’est introduit avant un besoin observé.

## Known risks

- Trois voix consomment trois appels ; le mode réel ne doit pas devenir le défaut de développement.
- La contribution reste vide pendant l’inférence Codex, puis apparaît rapidement en fragments. Un vrai streaming demanderait une sortie CLI textuelle incrémentale stable ou un autre adaptateur.
- Le mode réel dépend de la compatibilité des options du CLI et d’une session locale authentifiée ; les erreurs sont isolées par run mais cette dépendance doit rester visible.
- L’interface indique l’adaptateur actif mais n’affiche pas encore durée et consommation par carte.
- Les tests qui lancent un exécutable enfant nécessitent un environnement autorisant `spawn`; le sandbox restreint de l’agent retourne `EPERM`, alors que la suite hors sandbox et le runtime réel réussissent.
- Le démarrage parallèle de `pnpm dev` peut afficher brièvement The Assembly indisponible pendant que le daemon compile ; la reconnexion reprend ensuite automatiquement.
- CHALLENGE enregistre une disposition durable mais ne relance pas encore l’agent avec une objection humaine.
- Une seule décision immuable est autorisée par session ; le cycle de révision n’est pas encore modélisé.

## Open questions

- Quel index minimal de sessions permet de revenir à une ancienne quête sans créer un dashboard lourd ?
- Une révision doit-elle créer une nouvelle décision liée à la précédente ou une nouvelle session du Council ?

## Next orbit

**Orbite 5.1 — Ouvrir le Port.** Ajouter un index local minimal des sessions récentes et permettre de reprendre une session depuis l’interface, avec snapshot SQLite autoritaire et sans routeur ni nouvelle dépendance tant qu’ils ne sont pas nécessaires.
