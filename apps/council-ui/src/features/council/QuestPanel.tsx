import type { AssemblyHealthQuery } from '../../queries/useAssemblyHealth';
import type { CouncilSessionController } from '../../queries/useCouncilSession';

type QuestPanelProps = {
  health: AssemblyHealthQuery;
  councilSession: CouncilSessionController;
};

export function QuestPanel({ health, councilSession }: QuestPanelProps) {
  const isBusy =
    health.isFetching ||
    councilSession.isConvening ||
    councilSession.hasActiveRuns;
  const buttonLabel = councilSession.isConvening
    ? 'Convocation…'
    : councilSession.hasActiveRuns
      ? 'Council convoqué'
      : health.isFetching
        ? 'Vérification…'
        : health.isSuccess
          ? 'Convoquer le Council'
          : 'Vérifier The Assembly';

  const handlePrimaryAction = () => {
    if (health.isSuccess) {
      councilSession.convene();
      return;
    }

    void health.refetch();
  };

  return (
    <section className="quest-panel" aria-labelledby="quest-title">
      <div className="section-kicker">Quête</div>
      <h1 id="quest-title">Ouvrir la porte du royaume</h1>
      <p className="quest-description">
        Le royaume est scellé. Trouver et ouvrir la porte sans déclencher les
        anciens verrous ni trahir les pactes en vigueur.
      </p>
      <button
        className="primary-button"
        type="button"
        disabled={isBusy}
        onClick={handlePrimaryAction}
      >
        {buttonLabel}
      </button>
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
