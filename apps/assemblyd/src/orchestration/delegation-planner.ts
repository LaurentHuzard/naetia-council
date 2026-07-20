import type { AgentRole } from "@naetia/assembly-domain";

export interface DelegationRecommendation {
  readonly agentId: AgentRole;
  readonly reason: string;
}

const MODEL_QUEST = /\b(ai|agent|codex|context|ia|llm|model|modèle|prompt)\b/i;
const EXPERIENCE_QUEST =
  /\b(expérience|game|gamification|interface|jeu|parcours|produit|ui|ux)\b/i;
const RESEARCH_QUEST =
  /\b(benchmark|comparer|documentation|externe|recherche|source|vérifier)\b/i;

export function recommendDelegation(
  quest: Readonly<{ title: string; context?: string }>,
): readonly DelegationRecommendation[] {
  const text = `${quest.title}\n${quest.context ?? ""}`;
  if (MODEL_QUEST.test(text)) {
    return [
      {
        agentId: "llm-genie",
        reason: "Clarifier le contrat de modèle et la stratégie de contexte.",
      },
      {
        agentId: "architect",
        reason: "Protéger les frontières et la réversibilité du système.",
      },
      {
        agentId: "trickster",
        reason: "Séparer la valeur du rôle de celle du modèle choisi.",
      },
      {
        agentId: "guardian",
        reason: "Rendre visibles coûts, risques et contrôle humain.",
      },
    ];
  }
  if (EXPERIENCE_QUEST.test(text)) {
    return [
      {
        agentId: "game-designer",
        reason: "Dessiner une boucle d’usage engageante sans coercition.",
      },
      {
        agentId: "inner-child",
        reason: "Préserver simplicité, intuition et plaisir.",
      },
      {
        agentId: "architect",
        reason: "Donner une structure lisible au parcours.",
      },
      {
        agentId: "guardian",
        reason: "Détecter surcharge et pression artificielle.",
      },
    ];
  }
  if (RESEARCH_QUEST.test(text)) {
    return [
      {
        agentId: "scout",
        reason: "Distinguer les faits vérifiés des inconnues.",
      },
      {
        agentId: "architect",
        reason: "Relier les preuves à la décision à prendre.",
      },
      {
        agentId: "guardian",
        reason: "Signaler les limites et niveaux de confiance.",
      },
    ];
  }
  return [
    {
      agentId: "architect",
      reason: "Structurer la quête et ses choix.",
    },
    {
      agentId: "builder",
      reason: "Transformer la direction en preuve exécutable.",
    },
    {
      agentId: "guardian",
      reason: "Protéger les limites et le droit de revenir.",
    },
  ];
}
