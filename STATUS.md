# Naetia Council Status

Dernière mise à jour : 2026-07-20

## Statut

Active alpha. La Porte initiale est ouverte et le parcours vertical complet est
fonctionnel en local. Le Port retrouve et reprend maintenant les sessions
récentes sans les recréer. Une révision ouvre une session enfant liée sans
modifier la décision source et sans auto-convoquer les agents. Les trois voix
Codex d’une révision prennent maintenant explicitement en compte D1 et
l’intention humaine ; leurs durées et compteurs JSONL sont visibles et rejoués.
La Chambre affiche maintenant neuf membres, recommande une délégation modifiable
et ne crée des processus que pour les voix confirmées.

## Preuves actuelles

- typecheck, lint et build réussis sur les cinq projets du workspace ;
- 98 tests réussis : 4 domaine, 17 protocole, 2 registre, 63 daemon et 12 UI ;
- trois processus et trois appels Codex CLI distincts vérifiés ;
- décision, provenance et Return Point restaurés après rafraîchissement puis
  redémarrage du daemon ;
- index du Port identique avant et après redémarrage, reprise explicite vérifiée
  sans nouvelle création de session ;
- D1 strictement inchangée, D2 issue de trois nouveaux processus et lien de
  révision identique après redémarrage ;
- trois prompts Codex de révision contenant D1, son Return Point et l’intention
  exacte, avec isolation testée d’un JSONL invalide et d’un timeout ;
- durée, entrée, cache, sortie et raisonnement restaurés à l’identique après
  redémarrage sans PID vivant ni nouvel appel ;
- aucune erreur ni aucun warning dans la console Chromium du parcours vérifié.
- sélection Architect + Scout prouvée avec deux PID, deux fragments et aucun run
  Guardian ; mêmes définitions restaurées après redémarrage.

## Risques ouverts

- le mode réel consomme un appel par voix et doit rester opt-in ;
- le Full Council n’est pas encore orchestré en cercles ou limité en concurrence ;
- CHALLENGE ne déclenche pas encore de réponse contradictoire ;
- une décision ne possède qu’une révision directe ; les branches concurrentes sont refusées ;
- le Port est limité aux huit sessions les plus récentes et n’a ni recherche ni pagination ;
- la contribution Codex est révélée après réponse plutôt que streamée nativement.
- l’usage Codex peut être absent et ne constitue ni un coût ni un budget prédictif.

Source opérationnelle détaillée :
[`docs/mission-control.md`](docs/mission-control.md).
