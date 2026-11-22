import { expect, it } from "vitest";
import { restorablePreviewWindowBounds } from "./previewWindowPlacement";

it("restores a valid window on a left-hand display and falls back when the display is removed", () => {
	const primary = { x: 0, y: 0, width: 1920, height: 1040 };
	const secondary = { x: -1440, y: 0, width: 1440, height: 1040 };
	const previous = { x: -1250, y: 50, width: 1082, height: 630 };
	expect(restorablePreviewWindowBounds(previous, [primary, secondary])).toEqual(previous);
	expect(restorablePreviewWindowBounds(previous, [primary])).toBeNull();
	expect(restorablePreviewWindowBounds({ ...previous, y: -1000 }, [secondary])).toBeNull();
	expect(restorablePreviewWindowBounds({ ...previous, width: -100 }, [secondary])).toBeNull();
});
