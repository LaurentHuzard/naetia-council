# Naetia Council

Naetia Council est un workbench local qui transforme une quête confuse en
décision navigable grâce à plusieurs perspectives indépendantes. The Assembly
possède les sessions, lance les agents et conserve un journal SQLite
append-only qui reste la source de vérité.

## État

Le parcours Quest → Assembly → Loot → Forge → Return est livré et vérifié avec
le modèle déterministe ainsi qu'avec trois invocations Codex CLI séparées. Les
fragments, dispositions humaines, décisions, provenance et Return Points sont
reconstruits depuis le journal après rafraîchissement ou redémarrage.

## Prochaine étape

Ouvrir un Port minimal vers les sessions récentes, sans dashboard lourd ni
seconde source de vérité. Le détail opérationnel courant vit dans
[`docs/mission-control.md`](docs/mission-control.md).

## Limites structurantes

- local-first, sans déploiement ni authentification distante ;
- faux modèle par défaut, mode Codex CLI explicitement activé ;
- une décision immuable par session pour cette première porte ;
- CHALLENGE conserve l'objection mais ne relance pas encore l'agent.
