import { useEffect, useState } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { DEFAULT_LIVE_ANNOTATION_OPTIONS, LIVE_ANNOTATION_TOOLS, type LiveAnnotationOptions } from "./liveAnnotationModel";

const marks = { pen: "✎", line: "╱", arrow: "↗", rectangle: "□", ellipse: "○", highlighter: "▰", text: "T", eraser: "◇" };
const labels = { pen: "Pen", line: "Line", arrow: "Arrow", rectangle: "Rectangle", ellipse: "Ellipse", highlighter: "Highlighter", text: "Text", eraser: "Eraser" };
const actions = { undo: "Undo", redo: "Redo", clear: "Clear" } as const;
const toolStyle = "min-w-8 rounded px-1.5 py-1 text-sm text-white/90 hover:bg-white/15 aria-pressed:bg-white/25";

export default function LiveAnnotationToolbar() {
	const t = useScopedT("launch");
	const [options, setOptions] = useState(DEFAULT_LIVE_ANNOTATION_OPTIONS);
	useEffect(() => window.electronAPI?.onLiveAnnotationOptions?.(setOptions), []);
	const change = (patch: Partial<LiveAnnotationOptions>) => {
		const next = { ...options, ...patch };
		setOptions(next);
		void window.electronAPI?.setLiveAnnotationTool?.(next);
	};
	return (
		<div role="toolbar" aria-label={t("annotation.title", "Screen annotation")} className="m-1 flex flex-col gap-1 rounded-xl bg-[#202124] p-2 text-white shadow-xl">
			<div className="flex items-center gap-1">
				{LIVE_ANNOTATION_TOOLS.map(tool => (
					<button type="button" className={toolStyle} aria-pressed={options.tool === tool} key={tool}
						aria-label={t(`annotation.${tool}`, labels[tool])} title={t(`annotation.${tool}`, labels[tool])}
						onClick={() => change({ tool })}>{marks[tool]}</button>
				))}
				<input type="color" value={options.color} aria-label={t("annotation.color", "Color")} title={t("annotation.color", "Color")}
					className="h-7 w-7" onChange={event => change({ color: event.target.value })} />
				{(Object.keys(actions) as (keyof typeof actions)[]).map(command => (
					<button type="button" className={toolStyle} key={command} onClick={() => void window.electronAPI?.sendLiveAnnotationCommand?.(command)}>
						{t(`annotation.${command}`, actions[command])}
					</button>
				))}
			</div>
			<div className="flex items-center gap-3 px-1 text-xs">
				<label className="flex items-center gap-1">{t("annotation.weight", "Width")}
					<input type="number" className="w-12 rounded bg-white/10 px-1" min={1} max={24} value={options.weight}
						onChange={event => change({ weight: Math.max(1, Math.min(24, Number(event.target.value))) })} />
				</label>
				<label className="flex items-center gap-1">{t("annotation.fade", "Fade after (s, 0 off)")}
					<input type="number" className="w-12 rounded bg-white/10 px-1" min={0} max={120} value={options.fadeSeconds}
						onChange={event => change({ fadeSeconds: Math.max(0, Math.min(120, Number(event.target.value))) })} />
				</label>
				<button type="button" className={`${toolStyle} ml-auto`} onClick={() => void window.electronAPI?.toggleLiveAnnotation?.()}>{t("annotation.done", "Done")}</button>
			</div>
		</div>
	);
}
