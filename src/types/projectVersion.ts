export interface ProjectVersionEntry {
	id: string;
	path: string;
	source: "agent" | "app" | "before-restore";
	createdAt: number;
	durationMs: number;
	sizeBytes: number;
}
