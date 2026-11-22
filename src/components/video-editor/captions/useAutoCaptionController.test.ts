import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useAutoCaptionController } from "./useAutoCaptionController";
const state = vi.hoisted(() => ({ refs: [] as { current: unknown }[], index: 0 }));
vi.mock("react", () => ({
	useCallback: (callback: unknown) => callback,
	useEffect: () => {},
	useState: (value: unknown) => [value, vi.fn()],
	useRef: (current: unknown) => {
		const index = state.index++;
		state.refs[index] ??= { current };
		return state.refs[index];
	},
}));
vi.mock("@/components/ui/toast", () => ({
	toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));
beforeEach(() => {
	state.refs = [];
	state.index = 0;
});
afterEach(() => vi.unstubAllGlobals());
function setup() {
	let complete!: (result: unknown) => void;
	const generateAutoCaptions = vi.fn(
		() =>
			new Promise((resolve) => {
				complete = resolve;
			}),
	);
	vi.stubGlobal("window", { electronAPI: { generateAutoCaptions } });
	const params = {
		videoSourcePath: "/recordings/a.mp4",
		videoPath: "file:///recordings/a.mp4",
		whisperModelPath: "/models/small.bin",
		isGeneratingCaptions: false,
		autoCaptionSettings: { language: "en" },
		setIsGeneratingCaptions: vi.fn(),
		setAutoCaptions: vi.fn(),
		setAutoCaptionSettings: vi.fn(),
		openCaptionTranscript: vi.fn(),
		transcript: null,
		setTranscript: vi.fn(),
		syncActiveVideoSource: vi.fn(),
		t: (key: string) => key,
	} as unknown as Parameters<typeof useAutoCaptionController>[0];
	const render = () => {
		state.index = 0;
		return useAutoCaptionController(params);
	};
	return {
		params,
		render,
		generateAutoCaptions,
		complete: (result: unknown) => complete(result),
	};
}
const cues = [{ id: "generated", startMs: 0, endMs: 1000, text: "Hello" }];

it("imports without a model, prevents concurrent ASR, and enables subtitles without resetting styles", async () => {
	const test = setup();
	test.params.whisperModelPath = null;
	let completeImport!: (result: unknown) => void;
	const importSrtCaptions = vi.fn(() => new Promise(resolve => { completeImport = resolve; }));
	Object.assign(window.electronAPI, {importSrtCaptions});
	const controller = test.render();
	const pending = controller.handleImportSrtCaptions();
	await controller.handleImportSrtCaptions();
	await controller.handleGenerateAutoCaptions();
	expect(importSrtCaptions).toHaveBeenCalledTimes(1);
	expect(test.generateAutoCaptions).not.toHaveBeenCalled();
	const imported = [{...cues[0],timeBasis:"timeline"}];
	completeImport({success:true,cues:imported});
	await pending;
	expect(test.params.setAutoCaptions).toHaveBeenCalledWith(imported);
	expect(test.params.openCaptionTranscript).toHaveBeenCalledOnce();
	const update = vi.mocked(test.params.setAutoCaptionSettings).mock.calls[0][0] as (value: object) => object;
	expect(update({fontFamily:"IBM Plex Sans SC",fontSize:44})).toEqual({fontFamily:"IBM Plex Sans SC",fontSize:44,enabled:true});
});

it.each([{success:false,canceled:true},{success:false,errorCode:"invalidFormat"}])("preserves existing subtitles on cancelled or failed import %j", async (result) => {
	const test = setup();
	Object.assign(window.electronAPI,{importSrtCaptions:vi.fn(async () => result)});
	await test.render().handleImportSrtCaptions();
	expect(test.params.setAutoCaptions).not.toHaveBeenCalled();
	expect(test.params.setAutoCaptionSettings).not.toHaveBeenCalled();
	expect(test.params.openCaptionTranscript).not.toHaveBeenCalled();
});

it("discards an import after switching to another project using the same video", async () => {
	const test = setup();
	test.params.projectPath = "/projects/a.leadcut";
	let completeImport!: (result: unknown) => void;
	Object.assign(window.electronAPI,{importSrtCaptions:() => new Promise(resolve => {completeImport=resolve;})});
	const pending = test.render().handleImportSrtCaptions();
	test.params.projectPath = "/projects/b.leadcut";
	test.render();
	completeImport({success:true,cues});
	await pending;
	expect(test.params.setAutoCaptions).not.toHaveBeenCalled();
});
it("deduplicates requests and enables captions without resetting the active session", async () => {
	const test = setup();
	const controller = test.render();
	const pending = controller.handleGenerateAutoCaptions();
	await controller.handleGenerateAutoCaptions();
	expect(test.generateAutoCaptions).toHaveBeenCalledTimes(1);
	test.complete({ success: true, cues });
	await pending;
	expect(test.params.setAutoCaptions).toHaveBeenCalledWith(cues);
	expect(test.params.setAutoCaptionSettings).toHaveBeenCalledOnce();
	expect(test.params.syncActiveVideoSource).not.toHaveBeenCalled();
	expect(test.params.setIsGeneratingCaptions).toHaveBeenLastCalledWith(false);
});
it("discards results after switching recordings", async () => {
	const test = setup();
	const pending = test.render().handleGenerateAutoCaptions();
	test.params.videoSourcePath = "/recordings/b.mp4";
	test.render();
	test.complete({ success: true, cues });
	await pending;
	expect(test.params.setAutoCaptions).not.toHaveBeenCalled();
	expect(test.params.setIsGeneratingCaptions).toHaveBeenLastCalledWith(false);
});
it("preserves existing captions on failure and permits retry", async () => {
	const test = setup();
	const controller = test.render();
	const pending = controller.handleGenerateAutoCaptions();
	test.complete({ success: false, error: "Transcription failed" });
	await pending;
	expect(test.params.setAutoCaptions).not.toHaveBeenCalled();
	const retry = controller.handleGenerateAutoCaptions();
	test.complete({ success: true, cues });
	await retry;
	expect(test.generateAutoCaptions).toHaveBeenCalledTimes(2);
	expect(test.params.setAutoCaptions).toHaveBeenCalledWith(cues);
});

it.each([false, true])("discards same-source project results, including returning to the original project (%s)", async (returnToOriginal) => {
	const test = setup();
	test.params.projectPath = "/projects/a.leadcut";
	const pending = test.render().handleGenerateAutoCaptions();
	test.params.projectPath = "/projects/b.leadcut";
	test.render();
	if (returnToOriginal) {
		test.params.projectPath = "/projects/a.leadcut";
		test.render();
	}
	test.complete({ success: true, cues });
	await pending;
	expect(test.params.setAutoCaptions).not.toHaveBeenCalled();
	expect(test.params.setAutoCaptionSettings).not.toHaveBeenCalled();
});
