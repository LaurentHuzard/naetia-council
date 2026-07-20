# Naetia Council — Product Foundation

Date de décision : 20 juillet 2026
Statut : fondation canonique du prototype local

## Verdict

> The whole Council is always present. The right members earn the floor.

> The Assembly owns the state. Agents own their perspective. Docker earns its place.

Naetia Council montre une Chambre complète de neuf membres. Une session ne crée
des `AgentRun` que pour la délégation confirmée par l’humain. Un membre n’est ni
un processus permanent, ni une obligation de produire du texte.

Le prototype reste local-first : React et Vite dans le navigateur, un daemon
Fastify séparé, HTTP et SSE, un processus Node par run, SQLite possédé uniquement
par The Assembly. Docker reste hors de la boucle de développement et devra
répondre à un besoin de distribution ou de frontière système réel.

## Chambre permanente

| Membre | Mandat |
| --- | --- |
| Architect | Structure, dépendances et cohérence globale |
| Builder | Faisabilité et passage vers un artefact concret |
| Trickster | Remise en cause des prémisses et alternatives |
| Guardian | Risques, sécurité, surcharge et limites |
| Archivist | Mémoire, provenance et synthèse fidèle |
| Game Designer | Engagement, progression et boucle d’usage non coercitive |
| LLM Genie | Modèles, prompts, contexte et orchestration IA |
| Inner Child | Simplicité, intuition, plaisir et curiosité |
| Scout | Recherche, vérification et collecte d’informations |

Les définitions sont versionnées. Une session journalise les définitions exactes
qu’elle a convoquées afin que la provenance historique ne dépende jamais du
catalogue courant.

## Présence, délégation et run

```text
AgentDefinition permanente
        ↓ recommandation explicable
sélection humaine de la délégation
        ↓ confirmation
AgentRun éphémère
        ↓
processus Node isolé
```

La délégation n’est pas une nouvelle table. Dans cette tranche, l’événement
`session.convened` constitue son snapshot durable.

## Modes de convocation

- **Focused Party** — deux ou trois voix pour une question ciblée.
- **Council Delegation** — quatre à six voix utiles à une décision importante.
- **Full Council** — les neuf membres pour une quête fondatrice.

Le bouton Full Council signifie sélectionner les neuf membres ; il ne justifie
ni neuf processus permanents, ni neuf conteneurs. Sa chorégraphie en cercles et
sa limite de concurrence doivent être prouvées avant d’être considérées comme
terminées.

## Parcours canonique

```text
Port → Quest → Chamber → Delegation → Convene → Assembly
     → Loot → Duel → Forge → Return → Restart → Share
```

The Assembly peut recommander une délégation déterministe et explicable, mais
l’humain peut toujours retirer ou ajouter un membre avant toute consommation.
Une révision redemande cette confirmation et n’hérite jamais silencieusement
d’un Full Council.

## Orbites révisées

1. **5.4 — Toute la Chambre, seulement les bonnes voix** : neuf définitions,
   recommandation, modification humaine, sélection durable et nombre exact de
   processus.
2. **5.5 — Full Council en cercles** : limites de concurrence, first voices,
   counterpoints, evidence and memory, reprise après interruption.
3. **5.6 — Duel et renfort ciblé** : challenger un fragment avec un seul membre
   choisi et préserver les deux provenances.
4. **5.7 — Silence et structure des contributions** : aucune dissertation
   forcée ; missions, types, hypothèses et confiance explicites.
5. **5.8 — Partager sans web** : exports Markdown et JSON compréhensibles par
   une seconde personne.
6. **5.9 — Docker smoke test** : seulement après le parcours ci-dessus, sans
   imposer Docker au développement quotidien.

## Hors périmètre actuel

Pas de Docker de développement, conteneur par agent, PostgreSQL, Redis,
WebSocket, queue distribuée, fournisseur distinct par membre, mémoire globale
autonome, collaboration distante ou sélection de délégation par un LLM.
