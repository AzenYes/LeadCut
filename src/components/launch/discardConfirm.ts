export const DISCARD_CONFIRM_WINDOW_MS = 3000;

export function advanceDiscardConfirmation(deadlineMs: number | null, nowMs: number) {
	if (deadlineMs !== null && nowMs < deadlineMs) {
		return { shouldDiscard: true, deadlineMs: null } as const;
	}
	return { shouldDiscard: false, deadlineMs: nowMs + DISCARD_CONFIRM_WINDOW_MS } as const;
}
