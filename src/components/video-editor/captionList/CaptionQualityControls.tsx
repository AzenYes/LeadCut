import { Button } from "@/components/ui/button";
import { useUiText } from "@/i18n/useUiText";
import { CAPTION_ISSUE_KINDS, type CaptionQualityRules } from "../captionQuality";

export function CaptionQualityControls({
	count, filtered, onFilter, onPrevious, onNext,
}: {
	count: number;
	filtered: boolean;
	onFilter: (filtered: boolean) => void;
	onPrevious: () => void;
	onNext: () => void;
}) {
	const uiText = useUiText();
	return (
		<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
			<label className="flex items-center gap-1">
				<input type="checkbox" checked={filtered} onChange={event => onFilter(event.currentTarget.checked)} />
				{uiText("captionQualityOnlyIssues")}
				<span aria-hidden="true" className="tabular-nums">({count})</span>
			</label>
			<span role="status" className="sr-only" data-testid="caption-quality-count">
				{uiText("captionQualityCount", { value0: count })}
			</span>
			<Button size="sm" variant="ghost" disabled={count === 0} onClick={onPrevious}>{uiText("captionQualityPrevious")}</Button>
			<Button size="sm" variant="ghost" disabled={count === 0} onClick={onNext}>{uiText("captionQualityNext")}</Button>
		</div>
	);
}

export function CaptionQualityRuleSettings({ rules, onRulesChange }: {
	rules: CaptionQualityRules;
	onRulesChange: (rules: CaptionQualityRules) => void;
}) {
	const uiText = useUiText();
	const durationInput = (field: "minDurationMs" | "maxDurationMs") => {
		const label = uiText(field === "minDurationMs" ? "captionQualityMinDuration" : "captionQualityMaxDuration");
		return (
			<label className="flex min-w-0 flex-col gap-1 text-xs">
				{label}
				<input
					key={rules[field]}
					type="number"
					min={0}
					step={1}
					className="w-full rounded border border-border bg-background px-1.5 py-1 text-xs"
					defaultValue={rules[field]}
					onBlur={event => {
						const value = event.currentTarget.valueAsNumber;
						const lowerBound = field === "maxDurationMs" ? rules.minDurationMs : 0;
						const amount = Number.isFinite(value) ? Math.max(lowerBound, Math.round(value)) : rules[field];
						if (amount !== rules[field]) onRulesChange({ ...rules, [field]: amount });
						event.currentTarget.value = String(amount);
					}}
				onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) event.currentTarget.blur(); }}
				/>
			</label>
		);
	};

	return (
			<details className="text-xs">
				<summary className="cursor-pointer py-1">{uiText("captionQualityRules")}</summary>
				<div className="grid max-h-[22vh] grid-cols-2 gap-x-2 gap-y-1 overflow-auto pb-1 pt-1">
					{CAPTION_ISSUE_KINDS.map(kind => (
						<label key={kind} className="flex items-center gap-1">
							<input type="checkbox" checked={rules.enabled[kind]}
								onChange={event => onRulesChange({ ...rules, enabled: { ...rules.enabled, [kind]: event.currentTarget.checked } })} />
							{uiText(`captionQuality_${kind}`)}
						</label>
					))}
					{durationInput("minDurationMs")}
					{durationInput("maxDurationMs")}
				</div>
			</details>
	);
}
