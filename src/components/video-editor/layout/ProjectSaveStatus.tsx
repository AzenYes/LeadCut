import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useUiText } from "@/i18n/useUiText";
import type { useProjectSaveActions } from "../project/useProjectSaveActions";

export function ProjectSaveStatus({ feedback, dirty, onRetry, onSaveAs }: {
	feedback: ReturnType<typeof useProjectSaveActions>["saveFeedback"];
	dirty: boolean;
	onRetry: () => Promise<boolean>;
	onSaveAs: () => Promise<void>;
}) {
	const text = useUiText();
	const state = feedback.saving ? "saving" : feedback.error ? "failed" : dirty ? "pending" : "saved";
	const label = text(`saveStatus_${state}`);
	const lastSaved = feedback.savedAt ? text("saveStatusTime", { time: new Date(feedback.savedAt).toLocaleTimeString() }) : "";
	return (
		<div data-save-state={state} className="editor-save-status shrink-0 text-xs">
			{state === "failed" ? <Popover>
				<PopoverTrigger><Button variant="ghost" size="sm" className="h-8 text-danger" aria-label={label}>{label}</Button></PopoverTrigger>
				<PopoverContent aria-label={label} className="w-80 space-y-3">
					<p className="break-words text-sm">{feedback.error}</p>
					<p className="text-xs text-muted-foreground">{text("saveStatusFailureHelp")}</p>
					<div className="flex gap-2">
						<Button size="sm" onClick={() => void onRetry()}>{text("saveStatusRetry")}</Button>
						<Button size="sm" variant="secondary" onClick={() => void onSaveAs()}>{text("saveStatusSaveAs")}</Button>
					</div>
				</PopoverContent>
			</Popover> : <span title={lastSaved || label} className="text-muted-foreground">{label}</span>}
			<span className="sr-only" role="status" aria-live="polite">{label}</span>
		</div>
	);
}
