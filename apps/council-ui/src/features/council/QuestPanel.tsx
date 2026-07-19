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
  const hasDecision = councilSession.session?.decision !== undefined;
  const isBusy =
    health.isFetching ||
    councilSession.isConvening ||
    councilSession.hasActiveRuns ||
    (hasSession && !hasDecision);
  const buttonLabel = getPrimaryButtonLabel({
    isConvening: councilSession.isConvening,
    hasActiveRuns: councilSession.hasActiveRuns,
    hasDecision,
    hasSession,
    isCheckingHealth: health.isFetching,
    isHealthy: health.isSuccess,
  });

  const handlePrimaryAction = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (hasDecision) {
      councilSession.newQuest();
      return;
    }
    if (health.isSuccess) {
      councilSession.convene({
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
      <h1 id="quest-title">Quel passage veux-tu ouvrir ?</h1>
      <form className="quest-form" onSubmit={handlePrimaryAction}>
        <label>
          <span>Titre de la quête</span>
          <input
            name="quest-title"
            value={councilSession.session?.quest.title ?? title}
            maxLength={200}
            required
            disabled={hasSession}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          <span>Contexte facultatif</span>
          <textarea
            name="quest-context"
            value={councilSession.session?.quest.context ?? context}
            maxLength={10_000}
            rows={3}
            disabled={hasSession}
            onChange={(event) => setContext(event.target.value)}
          />
        </label>
        <button className="primary-button" type="submit" disabled={isBusy}>
          {buttonLabel}
        </button>
      </form>
      {health.isError ? (
        <p className="health-error" role="alert">
          The Assembly ne répond pas encore. Lancez le daemon puis réessayez.
        </p>
      ) : null}
      {councilSession.conveneError !== null ? (
        <p className="health-error" role="alert">
          La convocation a échoué. La session reste consultable et peut être
          relancée.
        </p>
      ) : null}
      {councilSession.sessionError !== null ||
      councilSession.cancelError !== null ||
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
  isConvening: boolean;
  hasActiveRuns: boolean;
  hasDecision: boolean;
  hasSession: boolean;
  isCheckingHealth: boolean;
  isHealthy: boolean;
}>): string {
  if (state.isConvening) return 'Convocation…';
  if (state.hasActiveRuns) return 'Council convoqué';
  if (state.hasDecision) return 'Nouvelle quête';
  if (state.hasSession) return 'Council terminé — choisir le butin';
  if (state.isCheckingHealth) return 'Vérification…';
  return state.isHealthy ? 'Convoquer le Council' : 'Vérifier The Assembly';
}
