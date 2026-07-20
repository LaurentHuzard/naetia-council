import { useState, type FormEvent } from 'react';

import type { AssemblyHealthQuery } from '../../queries/useAssemblyHealth';
import type { CouncilSessionController } from '../../queries/useCouncilSession';

type QuestPanelProps = {
  health: AssemblyHealthQuery;
  councilSession: CouncilSessionController;
};

export function QuestPanel({ health, councilSession }: QuestPanelProps) {
  const [title, setTitle] = useState('Ouvrir la porte du royaume');
  const [context, setContext] = useState(
    'Le royaume est scellé. Trouver et ouvrir la porte sans déclencher les anciens verrous ni trahir les pactes en vigueur.',
  );
  const hasSession = councilSession.session !== null;
  const hasPreparedSession = hasSession && councilSession.session!.runs.length === 0;
  const hasDecision = councilSession.session?.decision !== undefined;
  const isBusy =
    health.isFetching ||
    councilSession.isSessionLoading ||
    councilSession.isCreatingSession ||
    councilSession.isConvening ||
    councilSession.hasActiveRuns ||
    (councilSession.hasSelectedSession && !hasSession) ||
    (hasSession && councilSession.session!.runs.length > 0 && !hasDecision) ||
    hasDecision;
  const buttonLabel = getPrimaryButtonLabel({
    isSessionLoading: councilSession.isSessionLoading,
    isCreatingSession: councilSession.isCreatingSession,
    hasActiveRuns: councilSession.hasActiveRuns,
    hasDecision,
    hasSession,
    hasSessionError: councilSession.sessionError !== null,
    isCheckingHealth: health.isFetching,
    isHealthy: health.isSuccess,
  });

  const handlePrimaryAction = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      councilSession.hasSelectedSession &&
      (!hasSession || councilSession.sessionError !== null)
    ) {
      return;
    }
    if (health.isSuccess) {
      if (hasSession) {
        return;
      }
      councilSession.createQuest({
        title: title.trim(),
        ...(context.trim().length === 0 ? {} : { context: context.trim() }),
      });
      return;
    }

    void health.refetch();
  };

  return (
    <section className="quest-panel" aria-labelledby="quest-title">
      <div className="section-kicker">Quête</div>
      <h2 id="quest-title">Quel passage veux-tu ouvrir ?</h2>
      <form className="quest-form" onSubmit={handlePrimaryAction}>
        <label>
          <span>Titre de la quête</span>
          <input
            name="quest-title"
            value={
              councilSession.hasSelectedSession
                ? (councilSession.session?.quest.title ?? '')
                : title
            }
            maxLength={200}
            required
            disabled={councilSession.hasSelectedSession}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          <span>Contexte facultatif</span>
          <textarea
            name="quest-context"
            value={
              councilSession.hasSelectedSession
                ? (councilSession.session?.quest.context ?? '')
                : context
            }
            maxLength={10_000}
            rows={3}
            disabled={councilSession.hasSelectedSession}
            onChange={(event) => setContext(event.target.value)}
          />
        </label>
        {hasPreparedSession ? (
          <p className="quest-ready">
            Quête prête. Composez maintenant la délégation dans la Chambre.
          </p>
        ) : hasSession ? null : (
          <button className="primary-button" type="submit" disabled={isBusy}>
            {buttonLabel}
          </button>
        )}
      </form>
      {health.isError ? (
        <p className="health-error" role="alert">
          The Assembly ne répond pas encore. Lancez le daemon puis réessayez.
        </p>
      ) : null}
      {councilSession.createError !== null ? (
        <p className="health-error" role="alert">
          La quête n’a pas pu être préparée. Aucun agent n’a été lancé.
        </p>
      ) : null}
      {councilSession.sessionError !== null ? (
        <p className="health-error" role="alert">
          Cette session n’est plus disponible. Reprenez une autre quête depuis
          le Port ou ouvrez une nouvelle quête.
        </p>
      ) : null}
      {councilSession.cancelError !== null ||
      councilSession.signalError !== null ? (
        <p className="health-error" role="alert">
          Le dernier signal de session a échoué. Le snapshot autoritaire reste
          affiché et la lecture périodique prend le relais.
        </p>
      ) : null}
    </section>
  );
}

function getPrimaryButtonLabel(state: Readonly<{
  isSessionLoading: boolean;
  isCreatingSession: boolean;
  hasActiveRuns: boolean;
  hasDecision: boolean;
  hasSession: boolean;
  hasSessionError: boolean;
  isCheckingHealth: boolean;
  isHealthy: boolean;
}>): string {
  if (state.isSessionLoading) return 'Reprise…';
  if (state.hasSessionError) return 'Session indisponible';
  if (state.isCreatingSession) return 'Préparation…';
  if (state.hasActiveRuns) return 'Council convoqué';
  if (state.hasDecision) return 'Décision forgée';
  if (state.hasSession) return 'Council terminé — choisir le butin';
  if (state.isCheckingHealth) return 'Vérification…';
  return state.isHealthy ? 'Préparer la quête' : 'Vérifier The Assembly';
}
