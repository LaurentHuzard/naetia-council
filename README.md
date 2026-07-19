# Naetia Council

Naetia Council transforme une quête confuse en décision navigable grâce à plusieurs perspectives indépendantes. **Naetia Council** est le produit que l’humain utilise ; **The Assembly** est le runtime local qui possède les sessions, lance les agents et normalise leurs événements.

> No agent may make the quest heavier without making it clearer.

## Première porte

Cette première expédition couvre les Orbites 0 à 2 :

- un workspace pnpm TypeScript strict ;
- une interface React/Vite qui vérifie la disponibilité de The Assembly ;
- un daemon Fastify local ;
- un domaine et un protocole validé par Zod ;
- trois runs séparés — Architect, Trickster et Guardian — lancés avec `child_process.fork` ;
- un faux modèle déterministe, progressif, annulable et sans clé API.
- une reprise après rafraîchissement tant que le daemon reste actif.

La persistance SQLite, la forge complète et les fournisseurs de modèles réels ne sont pas encore livrés.

## Architecture locale

```text
Browser (React + Vite)
  └─ HTTP
      └─ The Assembly (Fastify, port 4317)
          ├─ orchestrateur en mémoire
          └─ process manager
              ├─ fork → Architect
              ├─ fork → Trickster
              └─ fork → Guardian
```

Les processus agents ne connaissent ni HTTP ni SQLite. Ils reçoivent un contexte immuable par IPC et publient uniquement des événements validés. Leur environnement est réduit à une allowlist et n’hérite pas des futures clés fournisseur du daemon.

## Prérequis

- Node.js 24 ou plus récent ;
- pnpm 11.

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

`ASSEMBLY_PORT` et `FAKE_MODEL_DELAY_MS` sont facultatifs. Les valeurs de référence figurent dans `.env.example`; exportez-les dans le shell avant `pnpm dev` pour les modifier. The Assembly reste volontairement lié à `127.0.0.1`.

L’interface conserve uniquement l’identifiant de session dans un stockage local versionné. Le snapshot du daemon demeure la source de vérité : un rafraîchissement retrouve la session, mais un redémarrage du daemon la perd encore.

SQLite sera introduit à l’Orbite 3. Son emplacement contractuel sera `data/naetia-council.sqlite`; aucun fichier de base n’est créé dans l’état actuel. Une future clé fournisseur restera exclusivement côté daemon. `.env.example` ne contient aucun secret.

## Limites actuelles

- les sessions sont en mémoire et disparaissent au redémarrage du daemon ;
- le transport live SSE, les fragments, la Forge et le Return Point restent à construire ;
- aucun vrai fournisseur de modèle n’est branché ;
- l’interface montre la première Assembly, pas encore le parcours complet Port → Return.
- le contrat HTTP de snapshot et les commandes génériques du protocole doivent encore être unifiés avant SSE ;
- une modification du code du worker pendant `pnpm dev` nécessite actuellement de relancer la commande pour reconstruire le fichier forké.

## Hors périmètre explicite

Pas de Docker, déploiement web, authentification distante, PostgreSQL, Redis, WebSocket, queue distribuée, base vectorielle, microservices ni marketplace d’agents.

Le cap vérifié et les risques ouverts sont consignés dans [Mission Control](docs/mission-control.md).
