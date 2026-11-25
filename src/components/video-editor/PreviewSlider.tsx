import { useEffect, useRef, useSyncExternalStore } from "react";
import type { createObservableValue } from "@/lib/observableValue";
import { SliderControl } from "./SliderControl";

export function PreviewSlider<T>({ label, value, min, max, step, formatValue, onChange, draft, readDraft, createDraft }: {
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	formatValue: (value: number) => string;
	onChange: (value: number) => void;
	draft: ReturnType<typeof createObservableValue<T | null>>;
	readDraft: (draft: T) => number | null;
	createDraft: (value: number) => T;
}) {
	const readPreviewValue = () => {
		const current = draft.get();
		return current === null ? null : readDraft(current);
	};
	const previewValue = useSyncExternalStore(draft.subscribe, readPreviewValue);
	const pointerDown = useRef(false);
	useEffect(() => () => draft.set(null), [draft]);

	const commit = () => {
		const next = readPreviewValue();
		pointerDown.current = false;
		if (next !== null) {
			onChange(next);
			draft.set(null);
		}
	};

	return (
		<div onPointerDownCapture={event => { if (event.button === 0) pointerDown.current = true; }}
			onPointerCancelCapture={commit}
			onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) commit(); }}>
			<SliderControl label={label} value={previewValue ?? value} min={min} max={max} step={step}
				onChange={next => { if (pointerDown.current) draft.set(createDraft(next)); else onChange(next); }}
				onCommit={commit} formatValue={formatValue} />
		</div>
	);
}
