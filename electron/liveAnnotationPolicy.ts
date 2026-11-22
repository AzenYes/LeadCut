export type LiveAnnotationWindowKind = "canvas" | "toolbar";

export function protectsLiveAnnotationWindow(kind: LiveAnnotationWindowKind) {
	return kind === "toolbar";
}

export function supportsLiveAnnotation(platform: NodeJS.Platform, sourceId: string | undefined) {
	return platform === "win32" && Boolean(sourceId?.startsWith("screen:"));
}
