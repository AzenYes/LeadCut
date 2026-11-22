import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/contexts/I18nContext";
import { useUiText } from "@/i18n/useUiText";

export function CaptionRippleDeleteDialog({ count, milliseconds, words, onCancel, onConfirm }: {
	count: number;
	milliseconds: number;
	words: boolean;
	onCancel: () => void;
	onConfirm: (skipNextTime: boolean) => void;
}) {
	const uiText = useUiText();
	const { locale } = useI18n();
	const [skipNextTime, setSkipNextTime] = useState(false);
	const seconds = (milliseconds / 1000).toLocaleString(locale, { maximumFractionDigits: 3 });

	return (
		<Dialog open onOpenChange={open => { if (!open) onCancel(); }}>
			<DialogContent className="max-w-sm">
				<DialogHeader>
					<DialogTitle>{uiText("captionRippleDeleteAction")}</DialogTitle>
					<DialogDescription>
						{uiText(words ? "captionRippleDeleteSelectedWords" : "captionRippleDeleteDescription",
							{ value0: count, value1: seconds })}
					</DialogDescription>
				</DialogHeader>
				{words && <p className="text-xs text-muted-foreground">{uiText("captionRippleDeleteWordHint")}</p>}
				<label className="flex items-center gap-2 text-sm">
					<input type="checkbox" checked={skipNextTime} onChange={event => setSkipNextTime(event.currentTarget.checked)} />
					{uiText("captionRippleDeleteSkipConfirm")}
				</label>
				<DialogFooter>
					<Button variant="ghost" onClick={onCancel}>{uiText("cancel")}</Button>
					<Button variant="destructive" onClick={() => onConfirm(skipNextTime)}>{uiText("captionRippleDeleteConfirm")}</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
