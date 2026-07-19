# ADR 0001 — Un processus par run agent

- Statut : accepté
- Date : 2026-07-19

## Contexte

La première version doit prouver que Architect, Trickster et Guardian sont des exécutions indépendantes, observables et annulables séparément. Une réponse unique simulant trois voix ne suffit pas.

## Décision

The Assembly lance chaque `AgentRun` avec `child_process.fork`. Le processus enfant reçoit un contexte sérialisable immuable, exécute le faux modèle et émet des messages IPC validés. Il ne connaît ni Fastify, ni l’interface, ni la persistance et ne peut pas lancer d’autre agent.

The Assembly reste propriétaire du statut de session, de l’annulation, des timeouts et, à partir de l’Orbite 3, des écritures SQLite.

## Conséquences

- un crash ou une annulation reste isolé au run concerné ;
- les PID distincts constituent une preuve simple de séparation ;
- le protocole IPC devient une frontière explicite à valider ;
- le coût de processus est accepté pour cette version locale à trois agents ; les conteneurs ne sont pas justifiés.
