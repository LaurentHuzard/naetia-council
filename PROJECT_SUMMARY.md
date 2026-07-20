# Naetia Council

Naetia Council est un workbench local qui transforme une quête confuse en
décision navigable grâce à plusieurs perspectives indépendantes. The Assembly
possède les sessions, lance les agents et conserve un journal SQLite
append-only qui reste la source de vérité.

## État

Le parcours Port → Quest → Assembly → Loot → Forge → Return est livré et vérifié avec
le modèle déterministe ainsi qu'avec trois invocations Codex CLI séparées. Les
fragments, dispositions humaines, décisions, provenance et Return Points sont
reconstruits depuis le journal après rafraîchissement ou redémarrage. Le Port
liste les sessions récentes depuis une projection compacte et en reprend une
sans créer de nouvelle session.

Une révision prépare désormais une session enfant liée à la décision source.
La première décision reste immuable, la nouvelle session commence sans run et
trois nouveaux agents ne démarrent qu’après une convocation humaine explicite.
Une révision Codex réelle a confirmé que chaque voix reçoit D1 et l’intention,
puis conserve, change ou conteste explicitement la décision précédente. Durée,
entrée, cache, sortie et raisonnement sont visibles par carte et restaurés depuis
le journal sans relancer les processus.

## Prochaine étape

Transformer CHALLENGE en contrepoint humain ciblé sans reconvoquer les trois
voix, sans effacer le fragment source et sans consommer de tokens avant une
confirmation explicite. Le détail opérationnel courant vit dans
[`docs/mission-control.md`](docs/mission-control.md).

## Limites structurantes

- local-first, sans déploiement ni authentification distante ;
- faux modèle par défaut, mode Codex CLI explicitement activé ;
- une décision immuable par session pour cette première porte ;
- CHALLENGE conserve l'objection mais ne relance pas encore l'agent.
- le Port est volontairement limité aux huit sessions les plus récentes.
- une décision possède au plus une révision directe dans cette première version.
