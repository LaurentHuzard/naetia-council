# ADR 0004 — Codex CLI est le premier adaptateur de modèle réel

## Statut

Accepté et implémenté le 2026-07-19.

## Contexte

Le Council doit fonctionner avec un modèle réel sans introduire maintenant un SDK fournisseur, une clé API supplémentaire ou un service distant dans l’architecture. La machine possède déjà Codex CLI et une authentification locale. Les trois voix doivent rester trois exécutions identifiables, jamais une réponse unique qui joue plusieurs rôles.

## Décision

Le mode `codex-cli` lance une commande `codex exec` indépendante dans chacun des trois processus agents. Le faux modèle déterministe demeure le mode par défaut.

The Assembly passe la définition versionnée de l’agent par IPC, écrit le prompt sur stdin et lit le flux JSONL du CLI. L’invocation est éphémère, ignore les règles et la configuration utilisateur, désactive la recherche web, utilise un sandbox en lecture seule et travaille dans un répertoire temporaire vide. Son environnement ne contient que `CODEX_HOME`. La contribution finale, la durée et l’usage retourné sont normalisés dans le protocole puis persistés par le daemon.

Le CLI ne fournissant pas actuellement de deltas textuels dans son JSONL stable, The Assembly révèle le message final en plusieurs fragments après réception. Ce comportement est présenté comme une révélation progressive, pas comme du streaming natif.

## Conséquences

- les trois voix coûtent trois appels modèle et peuvent terminer, échouer ou être annulées séparément ;
- aucune clé ou variable fournisseur ne traverse l’IPC ou le navigateur ;
- la session Codex locale reste une dépendance explicite du mode réel ;
- les tests restent hors réseau grâce à un faux exécutable JSONL ;
- un futur adaptateur SDK devra prouver une valeur supérieure avant d’ajouter une dépendance.
