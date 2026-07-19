import { create } from 'zustand';

const ACTIVE_SESSION_STORAGE_KEY = 'naetia-council-ui';

type CouncilUiState = {
  activeSessionId: string | null;
  followsLiveActivity: boolean;
  setActiveSessionId: (sessionId: string) => void;
  toggleLiveActivity: () => void;
};

export const useCouncilUiStore = create<CouncilUiState>((set) => ({
  activeSessionId: readActiveSessionId(),
  followsLiveActivity: true,
  setActiveSessionId: (activeSessionId) => {
    rememberActiveSessionId(activeSessionId);
    set({ activeSessionId });
  },
  toggleLiveActivity: () =>
    set((state) => ({ followsLiveActivity: !state.followsLiveActivity })),
}));

function readActiveSessionId(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const rawValue = window.localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
    if (rawValue === null) {
      return null;
    }
    const value: unknown = JSON.parse(rawValue);
    if (
      typeof value === 'object' &&
      value !== null &&
      'version' in value &&
      value.version === 1 &&
      'activeSessionId' in value &&
      typeof value.activeSessionId === 'string'
    ) {
      return value.activeSessionId;
    }
  } catch {
    return null;
  }
  return null;
}

function rememberActiveSessionId(activeSessionId: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(
      ACTIVE_SESSION_STORAGE_KEY,
      JSON.stringify({ version: 1, activeSessionId }),
    );
  } catch {
    // The server snapshot stays authoritative when browser storage is unavailable.
  }
}
