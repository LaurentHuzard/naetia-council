# ADR 0006 — Council permanent et délégation variable

## Statut

Accepté et implémenté le 20 juillet 2026.

## Contexte

Le prototype prouvait trois voix indépendantes, mais l’interface et le runtime
présentaient Architect, Trickster et Guardian comme l’intégralité du produit.
Cette limite d’exécution réduisait à tort l’identité du Council.

## Décision

Un package métier `@naetia/agent-definitions` contient les neuf définitions
versionnées du Council. L’interface montre ce catalogue permanent.

`POST /sessions/:sessionId/convene` accepte de un à neuf rôles distincts. The
Assembly les résout dans l’ordre canonique, journalise uniquement les
définitions convoquées dans `session.convened`, puis crée exactement un run et
un processus par membre sélectionné.

La délégation n’est pas une table ou une entité persistante supplémentaire.
L’événement existant est son snapshot durable. Le snapshot HTTP expose les
définitions journalisées afin que cartes, fragments et décisions historiques
ne soient jamais renommés depuis le catalogue courant.

Un retry avec le même ensemble est idempotent. Une sélection différente après
convocation est refusée. Un body absent conserve la triade historique pour les
anciens clients.

## Conséquences

- neuf membres existent sans neuf processus permanents ;
- le faux modèle accepte toute définition sans table fermée de rôles ;
- une session de révision choisit à nouveau sa délégation ;
- aucun schéma SQLite ni nouveau service n’est nécessaire ;
- un downgrade vers un binaire ne connaissant pas les nouveaux rôles n’est pas
  supporté après leur première convocation ;
- le Full Council peut sélectionner neuf voix, mais sa chorégraphie en cercles
  et sa limite de concurrence restent l’objectif de l’Orbite 5.5.
