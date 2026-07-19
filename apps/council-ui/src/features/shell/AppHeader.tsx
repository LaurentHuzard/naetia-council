import type { AssemblyHealthQuery } from '../../queries/useAssemblyHealth';

type AppHeaderProps = {
  health: AssemblyHealthQuery;
};

function getHealthLabel(health: AssemblyHealthQuery) {
  if (health.isPending) {
    return 'connexion…';
  }

  if (health.isError) {
    return 'indisponible';
  }

  return health.data.modelAdapter === 'codex-cli'
    ? 'disponible · Codex CLI'
    : 'disponible · Faux modèle';
}

export function AppHeader({ health }: AppHeaderProps) {
  const status = health.isError
    ? 'offline'
    : health.isSuccess
      ? 'online'
      : 'checking';

  return (
    <header className="app-header">
      <a className="brand" href="#main-content" aria-label="Naetia Council, accueil">
        Naetia Council
      </a>
      <div
        className="assembly-health"
        role="status"
        aria-label="État de The Assembly"
        aria-live="polite"
      >
        <span>The Assembly</span>
        <span className="health-separator" aria-hidden="true">
          ·
        </span>
        <span className={`health-dot health-dot--${status}`} aria-hidden="true" />
        <span className={`health-label health-label--${status}`}>
          {getHealthLabel(health)}
        </span>
      </div>
    </header>
  );
}
