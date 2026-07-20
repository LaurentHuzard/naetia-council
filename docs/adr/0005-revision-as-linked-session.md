# ADR 0005 — Une révision est une session liée

## Statut

Accepté et implémenté pendant l’Orbite 5.2.

## Contexte

Une décision, son Return Point, ses fragments et sa provenance sont immuables après la Forge. Ajouter une seconde décision dans la même session imposerait des rounds, plusieurs runs par rôle, des fragments rattachés à un round et une nouvelle projection d’historique.

## Décision

Une révision crée une nouvelle `CouncilSession` liée à la décision source par `revisionOf`. Le lien contient les identifiants de la session et de la décision sources ainsi que l’intention humaine de révision.

La session enfant réutilise la quête immuable. Lors de sa convocation, The Assembly dérive le contexte agent depuis la quête, l’intention, la décision précédente et son Return Point. La création n’exécute aucun agent : l’humain doit convoquer séparément le nouveau Council.

Une décision possède au plus une révision directe dans cette première version. Un retry avec la même intention retrouve le même enfant ; une intention concurrente est refusée. Le journal reste append-only et `session.created` transporte le lien optionnel, sans migration SQLite.

## Conséquences

- la session source, son curseur, ses événements et sa provenance restent inchangés ;
- chaque délibération conserve trois nouveaux runs et au plus une décision ;
- une révision peut elle-même devenir la source d’une révision suivante ;
- le Port distingue les sessions de révision et l’enfant expose D1 en lecture seule ;
- aucun round, historique éditable, nouvelle table ou nouvelle dépendance n’est introduit ;
- un ancien binaire ne peut pas relire un journal contenant le nouveau champ strict `revisionOf`.
