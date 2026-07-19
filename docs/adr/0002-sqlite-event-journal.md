# ADR 0002 — SQLite conserve un journal événementiel unique

## Statut

Accepté et implémenté pendant l’Orbite 3.

## Contexte

The Assembly doit retrouver les sessions, runs et contributions après redémarrage, dédupliquer les événements et rester l’unique propriétaire du stockage. Maintenir à la fois un journal et des tables de projection créerait deux vérités avant qu’un besoin de performance ne le justifie.

## Décision

The Assembly écrit des `CouncilEvent` validés dans une seule table SQLite append-only. `event_id` est unique et `sequence` définit l’ordre autoritaire. La projection en mémoire utilisée par HTTP est reconstruite exclusivement par relecture du journal au démarrage.

Une convocation journalise atomiquement les définitions versionnées et les trois runs avant de lancer les forks. Les événements IPC sont normalisés en événements Council avant persistance. Un run non terminal trouvé au démarrage devient `failed` avec le code `DAEMON_RESTARTED` et n’est pas relancé automatiquement.

Un fichier de propriété adjacent au journal garantit qu’un seul daemon vivant peut le posséder. Un verrou laissé après un crash est récupéré uniquement lorsque son PID n’existe plus.

## Conséquences

- SQLite reste l’unique source de vérité durable et l’unique writer est le daemon.
- Les doublons identiques sont des no-op ; une collision de contenu pour le même identifiant est refusée.
- Les futurs fragments, décisions et points de reprise pourront être conservés dans le même journal sans nouvelle infrastructure.
- La reconstruction complète est acceptable pour le volume local initial ; une projection persistée ne sera ajoutée qu’après mesure d’un besoin réel.
- Les PID ne sont pas restaurés comme processus vivants après redémarrage.
- Une panne d’écriture asynchrone rend le daemon indisponible plutôt que de servir une projection divergente.
