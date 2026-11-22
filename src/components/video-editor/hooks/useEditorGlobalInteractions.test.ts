import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, type ShortcutAction, type ShortcutsConfig } from "@/lib/shortcuts";
import { useEditorShortcuts } from "./useEditorShortcuts";

vi.mock("react", () => ({
	useEffect: (effect: () => void) => effect(),
	useRef: (current: unknown) => ({ current }),
}));
class Element {
	isContentEditable = false;
}
class Input extends Element { closest() { return this; } }
class Textarea extends Input {}
class Select extends Input {}
afterEach(() => vi.unstubAllGlobals());

function setup(bindings: Partial<ShortcutsConfig> = {}, repeatable?: ReadonlySet<ShortcutAction>) {
	const handlers = new Map<string, (event: KeyboardEvent) => void>();
	vi.stubGlobal("window", {
		addEventListener: (name: string, handler: (event: KeyboardEvent) => void) =>
			handlers.set(name, handler),
		removeEventListener: vi.fn(),
	});
	const actions = Object.fromEntries(SHORTCUT_ACTIONS.map(action => [action, vi.fn()])) as Record<ShortcutAction, ReturnType<typeof vi.fn>>;
	useEditorShortcuts({ ...DEFAULT_SHORTCUTS, ...bindings }, true, actions, repeatable);
	const send = (type = "keydown", options: Record<string, unknown> = {}) => {
		const event = {
			key: " ",
			code: "Space",
			target: new Element(),
			metaKey: false,
			ctrlKey: false,
			shiftKey: false,
			altKey: false,
			repeat: false,
			preventDefault: vi.fn(),
			stopImmediatePropagation: vi.fn(),
			...options,
		};
		handlers.get(type)!(event as unknown as KeyboardEvent);
		return event;
	};
	return { send, actions };
}

describe("editor playback shortcut", () => {
	it("consumes keydown and keyup and toggles once per physical press", () => {
		const { send, actions } = setup();
		const down = send();
		expect(down.preventDefault).toHaveBeenCalledOnce();
		expect(down.stopImmediatePropagation).toHaveBeenCalledOnce();
		send("keydown", { repeat: true });
		send(); // Even duplicate keydowns without the repeat flag belong to the held key.
		expect(actions.playPause).toHaveBeenCalledOnce();
		const up = send("keyup");
		expect(up.preventDefault).toHaveBeenCalledOnce();
		expect(up.stopImmediatePropagation).toHaveBeenCalledOnce();
		send();
		expect(actions.playPause).toHaveBeenCalledTimes(2);
		send("keyup");
		send();
		expect(actions.playPause).toHaveBeenCalledTimes(3);
	});
	it("ignores repeat-only events and recovers after losing window focus", () => {
		const { send, actions } = setup();
		send("keydown", { repeat: true });
		expect(actions.playPause).not.toHaveBeenCalled();
		send();
		send("blur");
		send();
		expect(actions.playPause).toHaveBeenCalledTimes(2);
	});
	it.each([
		new Input(),
		new Textarea(),
		new Select(),
		Object.assign(new Element(), { isContentEditable: true }),
	])("leaves editable controls alone", (target) => {
		const { send, actions } = setup();
		expect(send("keydown", { target }).preventDefault).not.toHaveBeenCalled();
		expect(send("keyup", { target }).preventDefault).not.toHaveBeenCalled();
		expect(actions.playPause).not.toHaveBeenCalled();
	});
	it("leaves composition and already handled events alone", () => {
		const { send, actions } = setup();
		expect(send("keydown", { isComposing: true }).preventDefault).not.toHaveBeenCalled();
		expect(send("keydown", { defaultPrevented: true }).preventDefault).not.toHaveBeenCalled();
		expect(actions.playPause).not.toHaveBeenCalled();
	});
	it("supports customized shortcuts and releases even if modifiers change", () => {
		const { send, actions } = setup({ playPause: { key: "k", ctrl: true } });
		expect(send().preventDefault).not.toHaveBeenCalled();
		send("keydown", { key: "k", code: "KeyK", metaKey: true });
		expect(actions.playPause).toHaveBeenCalledOnce();
		send("keyup", { key: "k", code: "KeyK", metaKey: false });
		send("keydown", { key: "k", code: "KeyK", metaKey: true });
		expect(actions.playPause).toHaveBeenCalledTimes(2);
	});
});

it("uses the new binding anywhere in the editor and ignores its previous key", () => {
	const { send, actions } = setup({ splitClip: { key: "b", ctrl: true } });
	send("keydown", { key: "F2", code: "F2" });
	expect(actions.splitClip).not.toHaveBeenCalled();
	send("keydown", { key: "b", code: "KeyB", metaKey: true });
	expect(actions.splitClip).toHaveBeenCalledOnce();
	send("keydown", { key: "b", code: "KeyB", metaKey: true, repeat: true });
	expect(actions.splitClip).toHaveBeenCalledOnce();
});

it("preserves source audio controls and limits repeating events to the allowed actions", () => {
	const { send, actions } = setup({}, new Set(["shuttleForward"]));
	const target = { closest: (selector: string) => selector.includes("[data-source-audio-editor]") ? target : null };
	send("keydown", { key: "l", code: "KeyL", target });
	expect(actions.shuttleForward).not.toHaveBeenCalled();
	send("keydown", { key: "l", code: "KeyL", repeat: true });
	expect(actions.shuttleForward).toHaveBeenCalledOnce();
	send("keydown", { key: "F2", code: "F2", repeat: true });
	expect(actions.splitClip).not.toHaveBeenCalled();
});
