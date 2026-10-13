// Human-effort measures derived from UI events (plan M4.3).
export type UiEventName =
  | "analysis_started"
  | "analysis_completed"
  | "clarification_shown"
  | "answer_started"
  | "answer_submitted"
  | "rewrite_shown"
  | "confirmed"
  | "manual_edit_started"
  | "manual_edit_completed";

export interface UiEvent {
  sessionKey: string;
  participantId: string;
  requirementId: string;
  event: UiEventName | string;
  t: number; // epoch ms
}

export interface Timings {
  clarificationTimeMs: number | null; // sum over rounds: clarification_shown -> answer_submitted
  totalReviewTimeMs: number | null; // analysis_started -> confirmed
  manualEditTimeMs: number | null; // sum of manual_edit_started -> manual_edit_completed
}

function pairedSum(events: UiEvent[], start: string, end: string): number | null {
  let total = 0;
  let open: number | null = null;
  let pairs = 0;
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    if (e.event === start) open = e.t;
    else if (e.event === end && open !== null) {
      total += e.t - open;
      open = null;
      pairs++;
    }
  }
  return pairs ? total : null;
}

export function computeTimings(events: UiEvent[]): Timings {
  const first = (name: string) => events.filter((e) => e.event === name).map((e) => e.t).sort((a, b) => a - b)[0];
  const last = (name: string) => events.filter((e) => e.event === name).map((e) => e.t).sort((a, b) => b - a)[0];
  const start = first("analysis_started");
  const end = last("confirmed");
  return {
    clarificationTimeMs: pairedSum(events, "clarification_shown", "answer_submitted"),
    totalReviewTimeMs: start !== undefined && end !== undefined ? end - start : null,
    manualEditTimeMs: pairedSum(events, "manual_edit_started", "manual_edit_completed"),
  };
}
