# Naetia Council

Naetia Council transforme une quête confuse en décision navigable grâce à plusieurs perspectives indépendantes. **Naetia Council** est le produit que l’humain utilise ; **The Assembly** est le runtime local qui possède les sessions, lance les agents et normalise leurs événements.

> No agent may make the quest heavier without making it clearer.

## Première porte

Cette première expédition couvre les Orbites 0 à 5.4 :

- un workspace pnpm TypeScript strict ;
- une interface React/Vite qui vérifie la disponibilité de The Assembly ;
- un daemon Fastify local ;
- un domaine et un protocole validé par Zod ;
- une Chambre permanente de neuf membres avec des définitions versionnées ;
- une délégation recommandée, modifiable avant toute consommation ;
- un run et un processus `child_process.fork` uniquement par membre convoqué ;
- un faux modèle déterministe, progressif, annulable et sans clé API ;
- un mode Codex CLI optionnel qui lance un appel réel indépendant par run ;
- un provider OpenAI-compatible optionnel pour un serveur de chat local ;
- un journal SQLite append-only qui reconstruit les sessions après redémarrage ;
- un flux SSE rejouable par séquence avec reconnexion native du navigateur ;
- une interface qui recharge un snapshot autoritaire et déduplique les signaux ;
- un fragment durable par contribution terminée ;
- les dispositions humaines KEEP, CHALLENGE et COMPOST ;
- un orchestrateur de brouillon qui préremplit cinq champs à partir des seuls fragments KEEP sélectionnés, sans écrire dans le journal ;
- une Forge qui accepte uniquement des fragments conservés et calcule leur provenance côté serveur ;
- un Return Point qui réunit décision, objection ouverte, condition de révision et prochain petit geste.
- un Port local qui liste les huit sessions les plus récentes et permet d’en reprendre explicitement une.
- une révision qui prépare une nouvelle session liée sans modifier la décision source ni convoquer automatiquement les agents.
- une seconde délibération Codex qui reçoit explicitement D1 et l’intention humaine dans trois processus distincts ;
- la durée et les compteurs JSONL par voix, visibles puis restaurés après redémarrage.

Le parcours local Port → Quest → Assembly → Loot → Forge → Return fonctionne avec le faux modèle déterministe comme avec Codex CLI.

## Architecture locale

```text
Browser (React + Vite)
  └─ HTTP commands + snapshot, SSE events
      └─ The Assembly (Fastify, port 4317)
          ├─ journal SQLite → projection reconstruite
          ├─ orchestrateur des sessions
          ├─ orchestrateur de brouillon → provider OpenAI-compatible
          └─ process manager des runs vivants
              ├─ fork → membre convoqué A
              ├─ fork → membre convoqué B
              └─ fork → membre convoqué N
```

Les processus agents ne connaissent ni HTTP ni SQLite. Ils reçoivent un contexte immuable par IPC et publient uniquement des événements validés. Leur environnement est réduit à une allowlist et n’hérite pas des futures clés fournisseur du daemon.

## Prérequis

- Node.js 26 ou plus récent ;
- pnpm 11.

Pour le mode réel uniquement : Codex CLI installé et authentifié localement. Vérifiez-le avec `codex --version` puis `codex login status`.

## Installation et développement

```bash
pnpm install
pnpm dev
```

L’interface est servie par Vite sur `http://127.0.0.1:5173` et relaie `/api` vers The Assembly sur `http://127.0.0.1:4317`.

## Parcours local

1. Depuis le Port, commencez une nouvelle quête ou reprenez explicitement une session récente.
2. Décrivez une quête, puis préparez-la sans lancer de processus.
3. Dans la Chambre, acceptez ou modifiez la délégation recommandée ; le bouton
   Full Council sélectionne les neuf membres.
4. Confirmez la convocation, puis attendez les contributions séparées des voix choisies.
5. Classez chaque fragment avec KEEP, CHALLENGE ou COMPOST.
6. Sélectionnez au moins un fragment conservé dans la Forge.
7. Préremplissez facultativement le brouillon avec l’orchestrateur, puis relisez et modifiez la décision vivante, sa raison, l’objection ouverte, la condition de révision et le prochain petit geste.
8. Forge affiche le Return Point et verrouille la provenance de cette première décision.
9. Si le contexte change, préparez une révision en décrivant ce qui a changé.
10. Vérifiez la décision précédente, recomposez sa délégation, puis convoquez-la explicitement.

CHALLENGE conserve l’objection humaine dans le journal, mais ne relance pas encore
l’agent. Une session accepte une seule décision forgée ; ses sources deviennent
immuables après la Forge. Une révision ouvre une session enfant sans run et
redemande une délégation. Un retry identique retrouve le même enfant et une
intention concurrente est refusée.

## Commandes

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Modèle et données

`MODEL_ADAPTER=fake` est le mode par défaut. Il ne consomme aucun token, produit plusieurs deltas reproductibles et respecte l’annulation.

Pour utiliser un serveur de chat OpenAI-compatible, notamment llama.cpp sur un
compute node piloté séparément par TwinPilot :

```bash
export MODEL_ADAPTER=openai-compatible
export OPENAI_COMPATIBLE_CHAT_URL=http://compute-host:8003/v1/chat/completions
export OPENAI_COMPATIBLE_MODEL=local-council-model
export OPENAI_COMPATIBLE_MAX_TOKENS=384
export OPENAI_COMPATIBLE_ENABLE_THINKING=false
read -rsp "Compute API key: " OPENAI_COMPATIBLE_API_KEY; echo
export OPENAI_COMPATIBLE_API_KEY
pnpm dev
```

Le serveur doit charger un modèle **génératif** ; un modèle d’embeddings exposé
sur `/v1/embeddings` ne peut pas produire les contributions du Council. L’URL,
l’alias et la clé ne possèdent aucune valeur privée par défaut dans le dépôt.
The Assembly envoie un `POST /v1/chat/completions` non streamé, puis révèle
localement la contribution par fragments. La durée enregistrée couvre uniquement
l’appel HTTP. Les compteurs de tokens sont conservés seulement lorsque le
provider les fournit.

Dans la Forge, le bouton `Préremplir avec l’orchestrateur` envoie uniquement les
fragments KEEP sélectionnés au même provider avec une sortie JSON contrainte.
Le résultat préremplit les cinq champs mais ne forge pas la décision et ne crée
aucun événement : tant que l’humain ne confirme pas la Forge, le brouillon reste
modifiable et n’existe que dans le formulaire. Un JSON libre, incomplet ou
invalide produit une erreur explicite, sans fallback.

La clé reste dans l’environnement du daemon. Elle est copiée dans l’environnement
réduit des processus agents pour leurs contributions et utilisée directement par
l’orchestrateur de brouillon ; elle ne traverse ni l’IPC, ni l’API navigateur,
ni le journal SQLite. Une indisponibilité réseau, un statut HTTP non réussi, un JSON
invalide ou une réponse vide produit une erreur explicite sur l’appel concerné,
sans fallback silencieux vers le faux modèle ou Codex CLI.

`OPENAI_COMPATIBLE_MAX_TOKENS` vaut 512 par défaut,
`OPENAI_COMPATIBLE_RUN_TIMEOUT_MS` 180 secondes et
`OPENAI_COMPATIBLE_REVEAL_DELAY_MS` 40 ms.
`OPENAI_COMPATIBLE_ENABLE_THINKING` est facultatif : lorsqu’il vaut `true` ou
`false`, l’adaptateur transmet l’extension llama.cpp
`chat_template_kwargs.enable_thinking`; lorsqu’il est absent, le corps reste
strictement portable entre providers OpenAI-compatibles. Le cycle de vie distant
reste hors du code Council : TwinPilot lance et inspecte llama.cpp, tandis que
Council utilise seulement son endpoint HTTP.

Pour convoquer le Council avec Codex CLI :

```bash
export MODEL_ADAPTER=codex-cli
export CODEX_CLI_PATH=/chemin/absolu/vers/codex
export CODEX_HOME=/chemin/vers/.codex
pnpm dev
```

Chaque carte correspond alors à un processus agent et à une invocation `codex
exec` distincte. Chaque membre convoqué reçoit la même quête mais sa définition,
sa perspective et ses instructions versionnées. Pour une révision, The Assembly
dérive aussi D1, son objection, sa condition de révision, son dernier geste et
l’intention humaine. The Assembly appelle Codex directement, sans shell, avec le
prompt sur stdin, un répertoire temporaire vide, un sandbox `read-only`, la
recherche web désactivée et un environnement réduit à `CODEX_HOME`.
L’authentification ChatGPT existante du CLI reste locale ; aucune clé n’est
transmise à l’interface ou dans l’IPC.

`CODEX_MODEL` est facultatif : absent, Codex utilise son modèle par défaut. `CODEX_RUN_TIMEOUT_MS` vaut 180 secondes par défaut et `CODEX_REVEAL_DELAY_MS` contrôle l’apparition progressive dans les cartes. Codex CLI émet actuellement le message final plutôt que des deltas de texte natifs ; The Assembly révèle donc ce résultat par fragments après réception. La durée s’arrête dès la réception du résultat CLI et exclut cette révélation locale. Lorsqu’ils sont fournis, les tokens d’entrée, de cache, de sortie et de raisonnement sont journalisés avec la contribution puis affichés séparément ; aucun total ambigu ni coût monétaire n’est inventé. Si l’usage est absent, l’interface le dit explicitement.

`ASSEMBLY_PORT`, `ASSEMBLY_DB_PATH` et `FAKE_MODEL_DELAY_MS` sont facultatifs. Les chemins SQLite relatifs sont résolus depuis la racine du repository, quel que soit le répertoire courant. Les valeurs de référence figurent dans `.env.example`; exportez-les dans le shell avant `pnpm dev` pour les modifier. The Assembly reste volontairement lié à `127.0.0.1`.

L’interface conserve uniquement l’identifiant de session dans un stockage local versionné. Le Port charge un résumé compact avec `GET /sessions?limit=8`, puis la reprise recharge le snapshot complet avant d’ouvrir son flux SSE. Le journal du daemon demeure la source de vérité : un rafraîchissement ou un redémarrage reconstruit la même session sans relancer les agents. Après le snapshot, `EventSource` écoute les nouveautés ; la séquence SQLite sert de curseur et `Last-Event-ID` permet le rattrapage automatique.

Une contribution terminée et son fragment sont écrits dans la même transaction. KEEP, CHALLENGE et COMPOST sont idempotents lorsque la même commande est rejouée. La Forge refuse les fragments non conservés, dérive la provenance depuis les runs et écrit atomiquement `decision.forged` avec `return_point.updated`. Les anciens journaux contenant des contributions terminées sont complétés avec leurs fragments lors de la reconstruction, sans doublon au redémarrage suivant.

`POST /sessions/:sessionId/revisions` crée une session liée en état `created`. Le lien durable contient la décision source et l’intention humaine ; le texte de D1 reste une projection de sa session et n’est jamais copié par le navigateur. The Assembly compose le contexte des nouveaux agents au moment de la convocation. La création de la révision ne démarre aucun processus.

SQLite utilise par défaut `data/naetia-council.sqlite`. Le fichier est créé au premier démarrage et ignoré par Git. Un verrou de propriété empêche deux daemons vivants d’écrire dans le même journal. Chaque événement est validé par Zod avant écriture et après lecture ; son identifiant est unique et l’ordre durable vient de la séquence SQLite. Les identifiants Codex restent exclusivement dans `CODEX_HOME`, côté daemon. `.env.example` ne contient aucun secret.

## Limites actuelles

- le Full Council sélectionne et lance neuf runs distincts, mais leur
  orchestration en cercles avec limite de concurrence appartient à l’Orbite 5.5 ;
- le Port affiche les huit sessions les plus récentes, sans pagination, recherche, suppression ni URLs partageables ;
- CHALLENGE classe durablement un fragment mais ne convoque pas encore une réponse contradictoire ;
- une décision forgée reste immuable et unique dans sa session ; une décision ne possède qu’une révision directe et les branches concurrentes ne sont pas encore modélisées ;
- le downgrade vers un ancien binaire n’est pas supporté après l’écriture d’un lien `revisionOf` ;
- le streaming Codex est une révélation locale post-réponse, pas encore un streaming natif token par token ;
- les modes réels consomment des ressources et dépendent soit du CLI Codex, soit d’un endpoint OpenAI-compatible disponible ; le faux modèle reste le mode par défaut des tests ;
- le préremplissage orchestré de la Forge est actuellement disponible uniquement avec le provider OpenAI-compatible ; les modes fake et Codex CLI exigent une saisie humaine ;
- chaque rafale SSE provoque encore une relecture coalescée du snapshot complet ;
- un run interrompu par un arrêt brutal est marqué `DAEMON_RESTARTED` et n’est jamais relancé automatiquement ;
- une panne d’écriture SQLite pendant un streaming place le daemon en état dégradé `503` jusqu’à son redémarrage ;
- une modification du code du worker pendant `pnpm dev` nécessite actuellement de relancer la commande pour reconstruire le fichier forké.

## Hors périmètre explicite

Pas de Docker, déploiement web, authentification distante, PostgreSQL, Redis, WebSocket, queue distribuée, base vectorielle, microservices ni marketplace d’agents.

La fondation produit canonique est dans [Product Foundation](docs/product-foundation.md).
Le cap vérifié et les risques ouverts sont consignés dans [Mission Control](docs/mission-control.md).
