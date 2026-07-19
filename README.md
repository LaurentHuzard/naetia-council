# Naetia Council

Naetia Council transforme une quête confuse en décision navigable grâce à plusieurs perspectives indépendantes. **Naetia Council** est le produit que l’humain utilise ; **The Assembly** est le runtime local qui possède les sessions, lance les agents et normalise leurs événements.

> No agent may make the quest heavier without making it clearer.

## Première porte

Cette première expédition couvre les Orbites 0 à 4 :

- un workspace pnpm TypeScript strict ;
- une interface React/Vite qui vérifie la disponibilité de The Assembly ;
- un daemon Fastify local ;
- un domaine et un protocole validé par Zod ;
- trois runs séparés — Architect, Trickster et Guardian — lancés avec `child_process.fork` ;
- un faux modèle déterministe, progressif, annulable et sans clé API ;
- un mode Codex CLI optionnel qui lance un appel réel indépendant par run ;
- un journal SQLite append-only qui reconstruit les sessions après redémarrage ;
- un flux SSE rejouable par séquence avec reconnexion native du navigateur ;
- une interface qui recharge un snapshot autoritaire et déduplique les signaux.

Les fragments, la Forge et le Return Point ne sont pas encore livrés.

## Architecture locale

```text
Browser (React + Vite)
  └─ HTTP commands + snapshot, SSE events
      └─ The Assembly (Fastify, port 4317)
          ├─ journal SQLite → projection reconstruite
          ├─ orchestrateur
          └─ process manager des runs vivants
              ├─ fork → Architect
              ├─ fork → Trickster
              └─ fork → Guardian
```

Les processus agents ne connaissent ni HTTP ni SQLite. Ils reçoivent un contexte immuable par IPC et publient uniquement des événements validés. Leur environnement est réduit à une allowlist et n’hérite pas des futures clés fournisseur du daemon.

## Prérequis

- Node.js 24 ou plus récent ;
- pnpm 11.

Pour le mode réel uniquement : Codex CLI installé et authentifié localement. Vérifiez-le avec `codex --version` puis `codex login status`.

## Installation et développement

```bash
pnpm install
pnpm dev
```

L’interface est servie par Vite sur `http://127.0.0.1:5173` et relaie `/api` vers The Assembly sur `http://127.0.0.1:4317`.

## Commandes

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Modèle et données

`MODEL_ADAPTER=fake` est le mode par défaut. Il ne consomme aucun token, produit plusieurs deltas reproductibles et respecte l’annulation.

Pour convoquer le Council avec Codex CLI :

```bash
export MODEL_ADAPTER=codex-cli
export CODEX_CLI_PATH=/chemin/absolu/vers/codex
export CODEX_HOME=/chemin/vers/.codex
pnpm dev
```

Chaque carte correspond alors à un processus agent et à une invocation `codex exec` distincte. Architect, Trickster et Guardian reçoivent la même quête mais leurs propres définition, perspective et instructions. The Assembly appelle Codex directement, sans shell, avec le prompt sur stdin, un répertoire temporaire vide, un sandbox `read-only`, la recherche web désactivée et un environnement réduit à `CODEX_HOME`. L’authentification ChatGPT existante du CLI reste locale ; aucune clé n’est transmise à l’interface ou dans l’IPC.

`CODEX_MODEL` est facultatif : absent, Codex utilise son modèle par défaut. `CODEX_RUN_TIMEOUT_MS` vaut 180 secondes par défaut et `CODEX_REVEAL_DELAY_MS` contrôle l’apparition progressive dans les cartes. Codex CLI émet actuellement le message final plutôt que des deltas de texte natifs ; The Assembly révèle donc ce résultat par fragments après réception. La durée et, lorsqu’ils sont fournis par le CLI, les tokens d’entrée, de cache, de sortie et de raisonnement sont journalisés avec la contribution.

`ASSEMBLY_PORT`, `ASSEMBLY_DB_PATH` et `FAKE_MODEL_DELAY_MS` sont facultatifs. Les chemins SQLite relatifs sont résolus depuis la racine du repository, quel que soit le répertoire courant. Les valeurs de référence figurent dans `.env.example`; exportez-les dans le shell avant `pnpm dev` pour les modifier. The Assembly reste volontairement lié à `127.0.0.1`.

L’interface conserve uniquement l’identifiant de session dans un stockage local versionné. Le journal du daemon demeure la source de vérité : un rafraîchissement ou un redémarrage reconstruit la même session sans relancer les agents. Après le snapshot, `EventSource` écoute les nouveautés ; la séquence SQLite sert de curseur et `Last-Event-ID` permet le rattrapage automatique.

SQLite utilise par défaut `data/naetia-council.sqlite`. Le fichier est créé au premier démarrage et ignoré par Git. Un verrou de propriété empêche deux daemons vivants d’écrire dans le même journal. Chaque événement est validé par Zod avant écriture et après lecture ; son identifiant est unique et l’ordre durable vient de la séquence SQLite. Les identifiants Codex restent exclusivement dans `CODEX_HOME`, côté daemon. `.env.example` ne contient aucun secret.

## Limites actuelles

- les fragments, la Forge et le Return Point restent à construire ;
- l’interface montre la première Assembly, pas encore le parcours complet Port → Return ;
- le streaming Codex est une révélation locale post-réponse, pas encore un streaming natif token par token ;
- le mode Codex consomme des tokens et dépend de la disponibilité du CLI et de sa session locale ; le faux modèle reste le mode par défaut des tests ;
- le contrat HTTP de snapshot reste validé séparément dans l’UI ; seul le contrat événementiel traverse actuellement `assembly-protocol` ;
- chaque rafale SSE provoque encore une relecture coalescée du snapshot complet ;
- un run interrompu par un arrêt brutal est marqué `DAEMON_RESTARTED` et n’est jamais relancé automatiquement ;
- une panne d’écriture SQLite pendant un streaming place le daemon en état dégradé `503` jusqu’à son redémarrage ;
- une modification du code du worker pendant `pnpm dev` nécessite actuellement de relancer la commande pour reconstruire le fichier forké.

## Hors périmètre explicite

Pas de Docker, déploiement web, authentification distante, PostgreSQL, Redis, WebSocket, queue distribuée, base vectorielle, microservices ni marketplace d’agents.

Le cap vérifié et les risques ouverts sont consignés dans [Mission Control](docs/mission-control.md).
