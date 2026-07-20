# Naetia Council Status

Dernière mise à jour : 2026-07-20

## Statut

Active alpha. La Porte initiale est ouverte et le parcours vertical complet est
fonctionnel en local. Le Port retrouve et reprend maintenant les sessions
récentes sans les recréer. Une révision ouvre une session enfant liée sans
modifier la décision source et sans auto-convoquer les agents. Les trois voix
Codex d’une révision prennent maintenant explicitement en compte D1 et
l’intention humaine ; leurs durées et compteurs JSONL sont visibles et rejoués.

## Preuves actuelles

- typecheck, lint et build réussis sur les quatre projets du workspace ;
- 89 tests réussis ;
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

## Risques ouverts

- le mode réel consomme trois appels et doit rester opt-in ;
- CHALLENGE ne déclenche pas encore de réponse contradictoire ;
- une décision ne possède qu’une révision directe ; les branches concurrentes sont refusées ;
- le Port est limité aux huit sessions les plus récentes et n’a ni recherche ni pagination ;
- la contribution Codex est révélée après réponse plutôt que streamée nativement.
- l’usage Codex peut être absent et ne constitue ni un coût ni un budget prédictif.

Source opérationnelle détaillée :
[`docs/mission-control.md`](docs/mission-control.md).
