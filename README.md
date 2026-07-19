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
- un journal SQLite append-only qui reconstruit les sessions après redémarrage ;
- un flux SSE rejouable par séquence avec reconnexion native du navigateur ;
- une interface qui recharge un snapshot autoritaire et déduplique les signaux.

Les fragments, la Forge, le Return Point et les fournisseurs de modèles réels ne sont pas encore livrés.

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

`ASSEMBLY_PORT`, `ASSEMBLY_DB_PATH` et `FAKE_MODEL_DELAY_MS` sont facultatifs. Les chemins SQLite relatifs sont résolus depuis la racine du repository, quel que soit le répertoire courant. Les valeurs de référence figurent dans `.env.example`; exportez-les dans le shell avant `pnpm dev` pour les modifier. The Assembly reste volontairement lié à `127.0.0.1`.

L’interface conserve uniquement l’identifiant de session dans un stockage local versionné. Le journal du daemon demeure la source de vérité : un rafraîchissement ou un redémarrage reconstruit la même session sans relancer les agents. Après le snapshot, `EventSource` écoute les nouveautés ; la séquence SQLite sert de curseur et `Last-Event-ID` permet le rattrapage automatique.

SQLite utilise par défaut `data/naetia-council.sqlite`. Le fichier est créé au premier démarrage et ignoré par Git. Un verrou de propriété empêche deux daemons vivants d’écrire dans le même journal. Chaque événement est validé par Zod avant écriture et après lecture ; son identifiant est unique et l’ordre durable vient de la séquence SQLite. Une future clé fournisseur restera exclusivement côté daemon. `.env.example` ne contient aucun secret.

## Limites actuelles

- les fragments, la Forge et le Return Point restent à construire ;
- aucun vrai fournisseur de modèle n’est branché ;
- l’interface montre la première Assembly, pas encore le parcours complet Port → Return ;
- le contrat HTTP de snapshot reste validé séparément dans l’UI ; seul le contrat événementiel traverse actuellement `assembly-protocol` ;
- chaque rafale SSE provoque encore une relecture coalescée du snapshot complet ;
- un run interrompu par un arrêt brutal est marqué `DAEMON_RESTARTED` et n’est jamais relancé automatiquement ;
- une panne d’écriture SQLite pendant un streaming place le daemon en état dégradé `503` jusqu’à son redémarrage ;
- une modification du code du worker pendant `pnpm dev` nécessite actuellement de relancer la commande pour reconstruire le fichier forké.

## Hors périmètre explicite

Pas de Docker, déploiement web, authentification distante, PostgreSQL, Redis, WebSocket, queue distribuée, base vectorielle, microservices ni marketplace d’agents.

Le cap vérifié et les risques ouverts sont consignés dans [Mission Control](docs/mission-control.md).
