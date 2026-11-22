import { Card } from "@heroui/react";
import { lazy, Suspense, useEffect, useState } from "react";
import { useI18n } from "./contexts/I18nContext";
import { EditorLoadingSkeleton } from "./components/video-editor/layout/EditorLoadingSkeleton";

const HudWindow = lazy(() => import("./components/launch/HudWindow"));
const SourceSelector = lazy(() =>
	import("./components/launch/SourceSelector").then((module) => ({
		default: module.SourceSelector,
	})),
);
const CountdownOverlay = lazy(() =>
	import("./components/countdown/CountdownOverlay").then((module) => ({
		default: module.CountdownOverlay,
	})),
);
const UpdateToastWindow = lazy(() =>
	import("./components/launch/UpdateToastWindow").then((module) => ({
		default: module.UpdateToastWindow,
	})),
);
const EditorWindow = lazy(() => import("./components/video-editor/EditorWindow"));
const LiveAnnotationCanvas = lazy(() => import("./components/live-annotation/LiveAnnotationCanvas"));
const LiveAnnotationToolbar = lazy(() => import("./components/live-annotation/LiveAnnotationToolbar"));

export default function App() {
	const [windowType] = useState(
		() => new URLSearchParams(window.location.search).get("windowType") || "",
	);
	const { t } = useI18n();
	const appIconSrc = "/app-icons/leadcut-128.png";

	useEffect(() => {
		document.documentElement.dataset.windowType = windowType;

		if (
			windowType === "hud-overlay" ||
			windowType === "source-selector" ||
			windowType === "countdown" ||
			windowType === "update-toast" ||
			windowType === "live-annotation-canvas" ||
			windowType === "live-annotation-toolbar"
		) {
			document.body.style.background = "transparent";
			document.documentElement.style.background = "transparent";
			document.getElementById("root")?.style.setProperty("background", "transparent");
		}

		if (windowType === "hud-overlay") {
			document.documentElement.classList.add("hud-overlay-window");
			document.body.classList.add("hud-overlay-window");
			document.getElementById("root")?.classList.add("hud-overlay-window");
			window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
		} else if (windowType === "update-toast") {
			document.documentElement.style.overflow = "visible";
			document.body.style.overflow = "visible";
			document.getElementById("root")?.style.setProperty("overflow", "visible");
		}
	}, [windowType]);

	useEffect(() => {
		document.title =
			windowType === "editor"
				? t("app.editorTitle", "LeadCut Editor")
				: t("app.name", "LeadCut");
	}, [windowType, t]);

	let content;
	switch (windowType) {
		case "hud-overlay":
			content = <HudWindow />;
			break;
		case "source-selector":
			content = <SourceSelector />;
			break;
		case "countdown":
			content = <CountdownOverlay />;
			break;
		case "update-toast":
			content = <UpdateToastWindow />;
			break;
		case "editor":
			content = <EditorWindow />;
			break;
		case "live-annotation-canvas":
			content = <LiveAnnotationCanvas />;
			break;
		case "live-annotation-toolbar":
			content = <LiveAnnotationToolbar />;
			break;
		default:
			content = (
				<div className="flex h-full w-full items-center justify-center bg-editor-bg text-foreground">
					<Card className="flex-row items-center gap-4 px-6 py-5">
						<img
							src={appIconSrc}
							alt={t("app.name", "LeadCut")}
							className="h-12 w-12 rounded-xl"
						/>
						<div>
							<h1 className="text-xl font-semibold tracking-tight">
								{t("app.name", "LeadCut")}
							</h1>
							<p className="text-sm text-foreground/65">
								{t("app.subtitle", "Screen recording and editing")}
							</p>
						</div>
					</Card>
				</div>
			);
	}

	return (
		<Suspense fallback={windowType === "editor" ? <EditorLoadingSkeleton /> : null}>
			{content}
		</Suspense>
	);
}
