import { ProgressBar } from "@heroui/react";
import { useEffect, useState, type ReactNode } from "react";

type Props = {
	title: string;
	detail?: ReactNode;
	detailAfterElapsed?: { seconds: number; content: ReactNode };
	progress?: number | null;
	action?: ReactNode;
	icon?: ReactNode;
	className?: string;
	copyClassName?: string;
	showElapsed?: boolean;
};

export function BackgroundTaskStatus({ title, detail, detailAfterElapsed, progress, action, icon, className, copyClassName, showElapsed }: Props) {
	const [seconds, setSeconds] = useState(0);
	useEffect(() => {
		if (!showElapsed) return;
		const started = performance.now();
		const timer = window.setInterval(() => setSeconds(Math.floor((performance.now() - started) / 1000)), 1000);
		return () => window.clearInterval(timer);
	}, [showElapsed]);
	const visibleDetail = detailAfterElapsed && seconds >= detailAfterElapsed.seconds ? detailAfterElapsed.content : detail;

	return (
		<div className={className} data-background-task>
			<div className="flex min-w-0 items-center gap-2">
				{icon}
				<div className={copyClassName ?? "min-w-0 flex-1"}>
					<span role="status" className="block text-sm font-medium">{title}</span>
					{visibleDetail ? <small className="block text-xs text-muted-foreground">{visibleDetail}</small> : null}
				</div>
				{showElapsed && (
					<time className="ml-2 text-xs tabular-nums text-muted-foreground" dateTime={`PT${seconds}S`} aria-hidden="true">
						{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
					</time>
				)}
				{action}
			</div>
			{progress !== undefined && (
				<ProgressBar className="mt-2" aria-label={title} isIndeterminate={progress === null} value={progress ?? undefined}>
					<ProgressBar.Track>
						<ProgressBar.Fill />
					</ProgressBar.Track>
				</ProgressBar>
			)}
		</div>
	);
}
