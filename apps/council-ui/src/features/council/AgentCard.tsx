import type { AgentRunSnapshot, AgentRunStatus } from '../../api/assembly';
import type { AgentCardModel } from './agent-definitions';

type AgentCardProps = {
  agent: AgentCardModel;
  run: AgentRunSnapshot | undefined;
  cancelling: boolean;
  onCancel: (runId: string) => void;
};

const statusLabels: Record<AgentRunStatus, string> = {
  pending: 'En attente',
  starting: 'Démarrage',
  running: 'En cours',
  completed: 'Terminé',
  failed: 'Échec',
  cancelling: 'Annulation',
  cancelled: 'Annulé',
};

const tokenFormatter = new Intl.NumberFormat('fr-FR');
const durationFormatter = new Intl.NumberFormat('fr-FR', {
  maximumFractionDigits: 1,
});

function formatElapsed(run: AgentRunSnapshot | undefined) {
  if (run?.startedAt === undefined) {
    return '00:00';
  }

  const end = run.completedAt === undefined ? Date.now() : Date.parse(run.completedAt);
  const durationSeconds = Math.max(
    0,
    Math.floor((end - Date.parse(run.startedAt)) / 1_000),
  );
  const minutes = Math.floor(durationSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (durationSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function getActivity(run: AgentRunSnapshot | undefined) {
  if (run === undefined || run.status === 'pending') {
    return 'En attente de convocation…';
  }
  if (run.status === 'starting') {
    return 'Ouverture du processus agent…';
  }
  if (run.status === 'running') {
    return 'Perspective en cours de formulation…';
  }
  if (run.status === 'completed') {
    return 'Contribution finalisée.';
  }
  if (run.status === 'cancelling') {
    return 'Arrêt contrôlé du processus…';
  }
  if (run.status === 'cancelled') {
    return 'Exécution interrompue par l’utilisateur.';
  }
  return 'Le processus agent a rencontré une erreur.';
}

function canCancel(run: AgentRunSnapshot | undefined) {
  return (
    run !== undefined &&
    (run.status === 'pending' ||
      run.status === 'starting' ||
      run.status === 'running')
  );
}

function formatModelDuration(durationMs: number) {
  if (durationMs < 1_000) {
    return `${tokenFormatter.format(durationMs)} ms`;
  }
  return `${durationFormatter.format(durationMs / 1_000)} s`;
}

function ModelExecutionSummary({
  execution,
}: {
  execution: NonNullable<AgentRunSnapshot['modelExecution']>;
}) {
  const adapterLabel = execution.adapter === 'codex-cli' ? 'Codex CLI' : 'Faux modèle';
  const usage = execution.usage;

  return (
    <section className="agent-section model-execution" aria-label="Mesures du modèle">
      <div className="model-execution-heading">
        <h3>Exécution modèle</h3>
        <span>
          {adapterLabel}
          {execution.model === undefined ? '' : ` · ${execution.model}`}
        </span>
      </div>
      <dl className="model-metrics">
        <div>
          <dt>Durée</dt>
          <dd>{formatModelDuration(execution.durationMs)}</dd>
        </div>
        {usage === undefined ? null : (
          <>
            <div>
              <dt>Entrée</dt>
              <dd>{tokenFormatter.format(usage.inputTokens)}</dd>
            </div>
            <div>
              <dt>Cache</dt>
              <dd>{tokenFormatter.format(usage.cachedInputTokens)}</dd>
            </div>
            <div>
              <dt>Sortie</dt>
              <dd>{tokenFormatter.format(usage.outputTokens)}</dd>
            </div>
            <div>
              <dt>Raisonnement</dt>
              <dd>{tokenFormatter.format(usage.reasoningOutputTokens)}</dd>
            </div>
          </>
        )}
      </dl>
      {usage === undefined ? (
        <p className="model-usage-note">
          {execution.adapter === 'fake'
            ? 'Simulation locale · aucun jeton consommé.'
            : 'Usage non fourni par Codex CLI.'}
        </p>
      ) : null}
    </section>
  );
}

export function AgentCard({ agent, run, cancelling, onCancel }: AgentCardProps) {
  const titleId = `agent-${agent.id}-title`;
  const status = run?.status ?? 'pending';
  const contribution = run?.contribution.trim() ?? '';

  return (
    <article
      className={`agent-card agent-card--${agent.accent}`}
      aria-labelledby={titleId}
    >
      <div className="agent-heading">
        <div>
          <h2 id={titleId}>{agent.name}</h2>
          <p>{agent.description}</p>
        </div>
        <div className={`agent-status agent-status--${status}`} role="status">
          <span className={`status-ring status-ring--${status}`} aria-hidden="true" />
          <span>{statusLabels[status]}</span>
        </div>
      </div>

      <div className="agent-section agent-activity">
        <h3>Activité</h3>
        <p>{getActivity(run)}</p>
        {run?.pid !== undefined ? (
          <p className="process-id">Processus Node #{run.pid}</p>
        ) : run !== undefined ? (
          <p className="process-id">Exécution restaurée du journal</p>
        ) : null}
      </div>

      <div className="agent-section agent-contribution">
        <h3>Contribution</h3>
        {contribution.length > 0 ? (
          <div className="contribution-copy" aria-live="polite">
            {contribution}
          </div>
        ) : (
          <div className="empty-contribution">
            <p>Aucune contribution pour le moment.</p>
            <p>
              {run === undefined
                ? 'Le Council n’a pas encore été convoqué.'
                : 'La perspective se prépare.'}
            </p>
          </div>
        )}
        {run?.error !== undefined ? (
          <p className="run-error" role="alert">
            {run.error.message}
          </p>
        ) : null}
      </div>

      {run?.modelExecution === undefined ? null : (
        <ModelExecutionSummary execution={run.modelExecution} />
      )}

      <footer className="agent-footer">
        <span className="elapsed-label">Écoulé</span>
        <time dateTime="PT0S">{formatElapsed(run)}</time>
        <button
          type="button"
          disabled={!canCancel(run) || cancelling}
          title={canCancel(run) ? 'Annuler ce run uniquement' : 'Aucun run actif à annuler'}
          onClick={() => {
            if (run !== undefined) {
              onCancel(run.runId);
            }
          }}
        >
          {cancelling ? 'Arrêt…' : 'Annuler'}
        </button>
      </footer>
    </article>
  );
}
