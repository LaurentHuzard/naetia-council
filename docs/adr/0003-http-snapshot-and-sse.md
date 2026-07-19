# ADR 0003 — Snapshot HTTP autoritaire et événements SSE rejouables

## Statut

Accepté et implémenté pendant l’Orbite 4.

## Contexte

L’interface doit voir les contributions progressivement, survivre à une coupure et éviter les doublons. Le journal SQLite existe déjà comme source de vérité ordonnée. Ajouter WebSocket, broker ou projection cliente complète créerait une seconde autorité sans besoin démontré.

## Décision

L’interface charge d’abord `GET /sessions/:sessionId`, dont `eventCursor` contient la dernière séquence SQLite de cette session. Elle ouvre ensuite `GET /sessions/:sessionId/events?after=:cursor` avec `EventSource`.

Chaque message SSE porte le nom `council-event`, une `id` égale à la séquence durable et un `CouncilEvent` validé par `assembly-protocol` dans `data`. À la reconnexion, le serveur prend le maximum entre le paramètre `after` et l’en-tête natif `Last-Event-ID`.

Le serveur s’abonne aux événements committés avant de lire le backlog. Les événements reçus pendant cette lecture sont tamponnés, triés puis dédupliqués avant le passage en direct. Le SSE n’est jamais la source de vérité : l’interface coalesce les signaux et invalide le snapshot TanStack Query. Un polling d’une seconde reste actif uniquement comme filet de sécurité lorsqu’un run est vivant et que le flux n’est pas connecté.

## Conséquences

- un rafraîchissement commence par un état durable complet avant d’écouter le live ;
- une reconnexion reprend après la dernière séquence reçue sans confondre curseur et UUID métier ;
- une déconnexion du transport ne peut ni interrompre un run ni faire échouer l’orchestrateur ;
- les événements du protocole restent indépendants de Fastify et de React ;
- l’interface recharge encore des snapshots complets, mais les rafraîchissements concurrents sont coalescés ;
- aucun WebSocket, broker ou reducer métier dupliqué n’est introduit.
