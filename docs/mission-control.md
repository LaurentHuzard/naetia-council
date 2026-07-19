# Mission Control

## Current objective

Faire fonctionner en priorité le Council avec Codex CLI sans dégrader le faux modèle déterministe, l’isolation des trois runs ni la propriété SQLite de The Assembly.

## Current state

Le mode `codex-cli` est fonctionnel de bout en bout. Une convocation lance trois processus agents distincts et chacun exécute son propre `codex exec` avec la définition versionnée d’Architect, Trickster ou Guardian. Le prompt passe sur stdin ; l’invocation est éphémère, en lecture seule, sans recherche web, dans un répertoire temporaire vide et avec un environnement limité à `CODEX_HOME`.

Le faux modèle reste le mode par défaut. Le daemon expose l’adaptateur actif dans `/health`, l’interface l’indique dans son en-tête, et les contributions réelles conservent leur durée ainsi que l’usage retourné par Codex dans le journal SQLite.

## Last completed orbit

**Boucle prioritaire — Council sur Codex CLI.** Le parcours Quest → Convene → trois contributions indépendantes a été exécuté avec Codex CLI 0.144.6 authentifié via ChatGPT. La session réelle `d57e1358-69bb-49f1-8d93-c96f909311bd` a terminé avec trois PID distincts (`276512`, `276513`, `276514`) et trois contenus propres aux rôles. Après redémarrage du daemon sur le même SQLite, les contributions et leurs mesures ont été reconstruites sans PID vivant.

## Commands verified

- `rtk pnpm typecheck` — réussi.
- `rtk pnpm lint` — réussi, zéro warning.
- `rtk pnpm build` — réussi sur les quatre projets du workspace.
- `rtk pnpm test` — 57 tests réussis : 44 daemon, 4 UI, 3 domaine et 6 protocole.
- Test ciblé Codex CLI — 11 tests réussis : JSONL, prompt stdin, options de confinement, usage, erreurs stables, stderr masqué, exécutable absent et annulation.
- `rtk codex --version` — `codex-cli 0.144.6`.
- `rtk codex login status` — authentifié avec ChatGPT.
- `GET /health` sur le daemon réel — `modelAdapter: codex-cli`.
- Convocation réelle — trois runs `completed` en 13 280 ms, 16 793 ms et 15 048 ms.
- Usage réel journalisé — 29 414 tokens d’entrée dont 20 736 en cache, 1 009 tokens de sortie et 0 token de raisonnement déclaré sur les trois appels.
- Redémarrage réel — session reconstruite à `eventCursor: 44`, trois contributions complètes et trois `modelExecution` conservés.

## Decisions

- Le vrai modèle est opt-in avec `MODEL_ADAPTER=codex-cli`; `fake` reste la valeur par défaut et la base des tests réseau-indépendants.
- Une voix correspond à un fork et à une invocation Codex distincte. Aucun appel unique ne simule les trois rôles.
- La définition complète de l’agent traverse l’IPC comme contexte immuable ; le worker ne duplique pas les personas.
- Seul `CODEX_HOME` est transmis au worker et au CLI. Les variables fournisseur du daemon ne traversent pas cette frontière.
- Codex est lancé directement, sans shell, avec `--ephemeral`, `--ignore-user-config`, `--ignore-rules`, `--sandbox read-only`, recherche web désactivée et héritage shell désactivé.
- Le JSONL stable fournit actuellement un message final et non des deltas textuels. The Assembly révèle donc le résultat en fragments post-réponse et documente honnêtement cette limite.
- La durée et l’usage modèle appartiennent à l’événement durable `contribution.completed` afin d’être reconstruits après redémarrage.

## Known risks

- Trois voix consomment trois appels. Le smoke minimal a utilisé environ 29,4 k tokens d’entrée, malgré une majorité en cache ; le mode réel ne doit pas devenir le défaut de développement.
- La contribution reste vide pendant l’inférence Codex, puis apparaît rapidement en fragments. Un vrai streaming demanderait une sortie CLI textuelle incrémentale stable ou un autre adaptateur.
- Le mode réel dépend de la compatibilité des options du CLI et d’une session locale authentifiée ; les erreurs sont isolées par run mais cette dépendance doit rester visible.
- L’interface indique l’adaptateur actif mais n’affiche pas encore durée et consommation par carte.
- Les tests qui lancent un exécutable enfant nécessitent un environnement autorisant `spawn`; le sandbox restreint de l’agent retourne `EPERM`, alors que la suite hors sandbox et le runtime réel réussissent.

## Open questions

- Faut-il afficher immédiatement durée et usage dans les cartes, ou attendre la Forge pour éviter de charger l’Assembly ?
- Quel plus petit modèle de `Fragment` permet KEEP, CHALLENGE et COMPOST sans introduire une seconde vérité éditoriale ?

## Next orbit

**Orbite 5 — Construire la Porte du Royaume.** Ajouter les fragments, leur disposition humaine, la Forge et le Return Point dans un parcours vertical persistant, en conservant le faux modèle par défaut et Codex CLI comme preuve réelle opt-in.
