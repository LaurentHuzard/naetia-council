export function councilSessionKey(sessionId: string) {
  return ['council-session', sessionId] as const;
}
