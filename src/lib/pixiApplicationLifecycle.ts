import type { Application, Container } from "pixi.js";

type PixiInitializationState = "initializing" | "initialized" | "failed";
type PixiInitOptions = Parameters<Application["init"]>[0];

const initializationStates = new WeakMap<Application, PixiInitializationState>();
const destroyRequests = new WeakSet<Application>();
const destroyContexts = new WeakMap<Application, string>();
const completedCleanups = new WeakSet<Application>();
const borrowedGpuDevices = new WeakSet<Application>();

const RENDERER_DESTROY_OPTIONS = {
	removeView: true,
	releaseGlobalResources: false,
} as const;

const STAGE_DESTROY_OPTIONS = {
	children: true,
	texture: false,
	textureSource: false,
} as const;

export function getPixiRendererBackend(app: Application): "webgl" | "webgpu" | undefined {
	const name = app.renderer.name;
	if (name === "webgl" || name === "webgpu") return name;
}

function reportCleanupError(app: Application, error: unknown): void {
	const context = destroyContexts.get(app) ?? "Pixi application";
	console.warn(`[PixiApplication] Failed to clean up ${context}:`, error);
}

function destroyFailedApplication(app: Application): void {
	const partialApp = app as Partial<Application>;

	try {
		partialApp.stage?.destroy(STAGE_DESTROY_OPTIONS);
	} catch (error) {
		reportCleanupError(app, error);
	}

	try {
		partialApp.renderer?.destroy(RENDERER_DESTROY_OPTIONS);
	} catch (error) {
		reportCleanupError(app, error);
	}
}

function completeDestroy(app: Application): void {
	if (completedCleanups.has(app)) return;
	completedCleanups.add(app);

	// Pixi drops its device reference during teardown. Explicitly release a device
	// created for this application so repeated exports do not wait for garbage collection.
	const renderer = app.renderer;
	const webgpu = renderer && "gpu" in renderer ? renderer : undefined;
	const canvas = webgpu?.canvas as HTMLCanvasElement | undefined;
	const device = !borrowedGpuDevices.has(app) ? webgpu?.gpu?.device : undefined;
	try {
		if (initializationStates.get(app) === "initialized") {
			app.destroy(RENDERER_DESTROY_OPTIONS, STAGE_DESTROY_OPTIONS);
		} else {
			destroyFailedApplication(app);
		}
	} catch (error) {
		reportCleanupError(app, error);
	} finally {
		try {
			try {
				// Pixi destroys the view texture without destroying its canvas source.
				canvas?.getContext("webgpu")?.unconfigure();
			} finally {
				device?.destroy();
			}
		} catch (error) {
			reportCleanupError(app, error);
		}
	}
}

export async function initializePixiApplication(
	app: Application,
	options: PixiInitOptions,
): Promise<void> {
	if (initializationStates.has(app) || destroyRequests.has(app)) {
		throw new Error("Pixi application lifecycle has already started");
	}

	initializationStates.set(app, "initializing");
	if (options && "gpu" in options && options.gpu) borrowedGpuDevices.add(app);
	try {
		await app.init(options);
		initializationStates.set(app, "initialized");
	} catch (error) {
		initializationStates.set(app, "failed");
		if (destroyRequests.has(app)) completeDestroy(app);
		throw error;
	}

	if (destroyRequests.has(app)) completeDestroy(app);
}

export async function initializePixiApplicationWithTimeout(
	app: Application,
	options: PixiInitOptions,
	timeoutMs: number,
	backendLabel: string,
): Promise<void> {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timeoutId = setTimeout(() => {
			reject(
				new Error(
					`Initialization timed out after ${timeoutMs}ms for ${backendLabel} renderer`,
				),
			);
		}, timeoutMs);
	});

	try {
		await Promise.race([initializePixiApplication(app, options), timeoutPromise]);
	} finally {
		if (timeoutId !== undefined) clearTimeout(timeoutId);
	}
}

export function destroyPixiApplication(app: Application | null, context: string): void {
	if (!app || destroyRequests.has(app) || completedCleanups.has(app)) return;

	destroyRequests.add(app);
	destroyContexts.set(app, context);
	if (initializationStates.get(app) !== "initializing") completeDestroy(app);
}

export function destroyPixiContainer(container: Container | null): void {
	if (!container || container.destroyed) return;
	container.parent?.removeChild(container);
	container.destroy();
}
