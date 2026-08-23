# Naetia Council Status

Dernière mise à jour : 2026-08-23

## Statut

Active alpha. La Porte initiale est ouverte et le parcours vertical complet est
fonctionnel en local. Le Port retrouve et reprend maintenant les sessions
récentes sans les recréer. Une révision ouvre une session enfant liée sans
modifier la décision source et sans auto-convoquer les agents. Les trois voix
Codex d’une révision prennent maintenant explicitement en compte D1 et
l’intention humaine ; leurs durées et compteurs JSONL sont visibles et rejoués.
La Chambre affiche maintenant neuf membres, recommande une délégation modifiable
et ne crée des processus que pour les voix confirmées.
The Assembly possède aussi un provider OpenAI-compatible opt-in pour déléguer
les contributions à un serveur de chat local, sans SSH dans le produit et sans
fallback silencieux.

## Preuves actuelles

- typecheck, lint et build réussis sur les cinq projets du workspace ;
- 112 tests réussis : 4 domaine, 18 protocole, 2 registre, 75 daemon et 13 UI ;
- vertical slice OpenAI-compatible réussi avec un endpoint loopback synthétique,
  un worker séparé, authentification Bearer, contribution et métriques journalisées ;
- smoke test réel réussi avec Qwen3-4B Q4_K_M sur la RTX : une voix Architect
  terminée en 12,007 s, 270 tokens d’entrée dont 267 en cache et 258 de sortie ;
- serveurs chat et embeddings observés simultanément à environ 1 924 MiB et
  4 650 MiB de VRAM, sans arrêt du chemin d’embeddings ;
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
- le serveur chat RTX est un processus utilisateur lancé par TwinPilot, sans
  service ni autostart ; sa relance après redémarrage reste une responsabilité
  opérationnelle ;
- le premier smoke matériel couvre une seule voix ; avec un seul slot llama.cpp,
  une délégation étendue attend en file et doit être mesurée avant usage régulier ;

Source opérationnelle détaillée :
[`docs/mission-control.md`](docs/mission-control.md).
