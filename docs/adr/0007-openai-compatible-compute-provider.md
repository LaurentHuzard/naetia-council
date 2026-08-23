# ADR 0007 — Un endpoint OpenAI-compatible relie le Council au compute local

Date : 2026-08-23

## Contexte

The Assembly possède déjà un petit port `ModelAdapter`, un faux modèle et un
adaptateur Codex CLI. La RTX est un compute node spécialisé piloté par
TwinPilot ; elle ne doit pas introduire de commandes SSH, d’adresse privée ou de
cycle de vie llama.cpp dans le domaine du Council.

## Décision

Ajouter l’adaptateur opt-in `openai-compatible`. Sa configuration exige :

- l’URL HTTP complète de `/v1/chat/completions` ;
- l’alias de modèle attendu par le serveur ;
- éventuellement une clé API ;
- une sortie maximale, un timeout et un délai de révélation bornés ;
- éventuellement le booléen llama.cpp `enable_thinking`.

The Assembly envoie une complétion non streamée avec le prompt commun des voix,
puis publie localement des deltas comme l’adaptateur Codex. L’exécution conserve
le nom de l’adaptateur, le modèle, la durée de génération et les compteurs
standard uniquement lorsqu’ils existent.

La clé n’entre pas dans le protocole IPC. Le daemon la place uniquement dans
l’environnement réduit de chaque worker concerné. L’URL et la clé ne sont
retournées ni par `/health`, ni par les événements, ni par SQLite.

Les erreurs de transport, HTTP, JSON, schéma et contenu vide sont distinctes.
Aucun échec ne bascule silencieusement vers un autre adaptateur.

## Conséquences

Council peut utiliser llama.cpp sur une RTX ou tout autre serveur compatible
sans dépendre de SSH ni de TwinPilot dans son code métier. TwinPilot reste
responsable du lancement et de l’inspection du serveur ; Council ne connaît que
la boundary HTTP.

Ce premier incrément ne fournit pas de streaming natif, de retry automatique,
de routage multi-provider ni de téléchargement de modèle. Un smoke test matériel
demande qu’un modèle GGUF génératif soit déjà présent et servi séparément du
modèle d’embeddings.
