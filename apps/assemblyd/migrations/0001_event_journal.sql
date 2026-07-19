CREATE TABLE council_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  run_id TEXT,
  type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  event_json TEXT NOT NULL CHECK (json_valid(event_json))
);

CREATE INDEX council_events_session_sequence_idx
  ON council_events (session_id, sequence);

CREATE INDEX council_events_run_sequence_idx
  ON council_events (run_id, sequence)
  WHERE run_id IS NOT NULL;
