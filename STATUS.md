# Naetia Council Status

Dernière mise à jour : 2026-07-20

## Statut

Active alpha. La Porte initiale est ouverte et le parcours vertical complet est
fonctionnel en local. La prochaine tranche est l'Orbite 5.1 : un Port minimal
pour retrouver et reprendre les sessions récentes.

## Preuves actuelles

- typecheck, lint et build réussis sur les quatre projets du workspace ;
- 68 tests réussis ;
- trois processus et trois appels Codex CLI distincts vérifiés ;
- décision, provenance et Return Point restaurés après rafraîchissement puis
  redémarrage du daemon ;
- aucune erreur ni aucun warning dans la console Chromium du parcours vérifié.

## Risques ouverts

- le mode réel consomme trois appels et doit rester opt-in ;
- CHALLENGE ne déclenche pas encore de réponse contradictoire ;
- le cycle de révision d'une décision n'est pas encore modélisé ;
- la contribution Codex est révélée après réponse plutôt que streamée nativement.

Source opérationnelle détaillée :
[`docs/mission-control.md`](docs/mission-control.md).
