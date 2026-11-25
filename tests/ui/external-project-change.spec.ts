import { expect, test, type Page } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("a newer project opens for preview without accepting edits or saves", async ({ page }) => {
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true,
			path: "/projects/Newer.leadcut",
			revision: "future-revision",
			project: {
				version: 3,
				minReaderVersion: 3,
				videoPath: `${location.origin}/tests/ui/fixtures/waveform.mp4`,
				editor: { clipRegions: [{ id: "future-clip", startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 }] },
			},
		});
		window.electronAPI.saveProjectFile = async () => {
			document.documentElement.dataset.saveAttempts = "1";
			return { success: false };
		};
	});
	await page.goto("/?windowType=editor");
	const clip = page.locator('[data-region-id="future-clip"]');
	await expect(clip).toHaveCount(1, { timeout: 20_000 });
	await expect(page.getByText("This project is read-only. Open it in a newer version of LeadCut to edit it.")).toBeVisible();
	await page.keyboard.press("Control+s");
	await page.keyboard.press("Delete");
	await expect(clip).toHaveCount(1);
	await expect(page.locator("html")).not.toHaveAttribute("data-save-attempts");
});

test("autosave sends the opened revision and stops retrying when the disk version changes", async ({ page }) => {
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, () => {
		const capture = `${location.origin}/tests/ui/fixtures/waveform.mp4`;
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true,
			path: "/projects/Review.leadcut",
			revision: "opened-revision",
			project: {
				version: 2,
				projectId: "review-project",
				videoPath: capture,
				editor: { clipRegions: [{ id: "screen", startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 }] },
			},
		});
		window.electronAPI.saveProjectFile = async (_data, _name, _path, _thumbnail, expectedRevision) => {
			const root = document.documentElement;
			root.dataset.saveAttempts = String(Number(root.dataset.saveAttempts ?? 0) + 1);
			root.dataset.requestedRevision = expectedRevision;
			return { success: false, conflict: true, diskRevision: "agent-revision" };
		};
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-region-id="screen"]')).toHaveCount(1, { timeout: 20000 });
	await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0, { timeout: 20000 });
	await page.getByRole("button", { name: "Add caption", exact: true }).click();
	await expect(page.getByText("The project changed on disk. Your edits were not saved.", { exact: true })).toBeVisible();
	const html = page.locator("html");
	await expect(html).toHaveAttribute("data-requested-revision", "opened-revision");
	const transcript = page.getByRole("region", { name: "Caption transcript", exact: true });
	await transcript.locator("[data-caption-text]").click();
	const text = transcript.getByRole("textbox", { name: "Edit caption text", exact: true });
	await text.fill("Unsaved local caption");
	await text.press("Escape");
	await page.waitForTimeout(750);
	await expect(html).toHaveAttribute("data-save-attempts", "1");
	await expect(page.locator('[data-variant="caption"]')).toContainText("Unsaved local caption");
});

async function openProjectForExternalChange(page: Page, {
	agentHandoff = false, otherEdits = false, extraCaptionCount = 0, captionCut = "none",
} = {}) {
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, ({ agentHandoff, otherEdits, extraCaptionCount, captionCut }) => {
		const path = "/projects/Review.leadcut";
		const videoPath = `${location.origin}/tests/ui/fixtures/waveform.mp4`;
		const initial = { id: "screen", startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 };
		const oldCut = {
			id: "old-cut-log", kind: "cut", source: "agent", createdAt: "2026-11-21T09:00:00Z",
			batchId: "old-round", rangeIndex: 0, sourceStartMs: 500, sourceEndMs: 900,
			speed: 1, durationMs: 400, timelineMs: 500, review: "accepted",
		};
		const newCut = { ...oldCut, id: "new-cut-log", batchId: "new-round", createdAt: "2026-11-22T09:00:00Z",
			sourceStartMs: 3000, sourceEndMs: 3200, durationMs: 200, timelineMs: 3000, review: "pending" };
		const timeBasis = captionCut === "source" ? undefined : "timeline";
		const timelineCut = captionCut === "timeline";
		const secondCaption = { id: "caption-two", startMs: timelineCut ? 3500 : 2400,
			endMs: timelineCut ? 4500 : 3600, text: "Original second caption", timeBasis };
		const extraCaptions = Array.from({ length: extraCaptionCount }, (_, index) => ({
			id: `caption-extra-${index}`, startMs: 4000 + index * 40, endMs: 4035 + index * 40,
			text: `Original extra caption ${index}`, timeBasis,
		}));
		const base = { version: 2, projectId: "review-project", videoPath, editor: {
			clipRegions: [initial], ...(agentHandoff ? { changeLog: { version: 1, entries: [oldCut] } } : {}),
			...(otherEdits ? { autoCaptionSettings: { enabled: true, fontSize: 30 }, autoCaptions: [
				{ id: "caption-one", startMs: 1000, endMs: 2000, text: "Original caption", timeBasis },
				secondCaption,
				...extraCaptions,
			] } : {}),
		} };
		const agent = otherEdits ? { ...base, editor: { ...base.editor,
			...(captionCut !== "none" ? {
				clipRegions: [{ ...initial, endMs: 3000 }, { ...initial, id: "agent-cut", startMs: 3000, endMs: 5800, sourceStartMs: 3200 }],
				changeLog: { version: 1, entries: [oldCut, newCut] },
			} : {}),
			autoCaptionSettings: { enabled: true, fontSize: 55 },
			autoCaptions: [
				{ id: "caption-one", startMs: 1000, endMs: 2000, text: "Agent caption", timeBasis },
				timelineCut ? { ...secondCaption, startMs: 3300, endMs: 4300 } : { ...secondCaption, text: "Agent second caption" },
				...extraCaptions.map(caption => ({ ...caption, text: caption.text.replace("Original", "Agent") })),
			],
		} } : { ...base, editor: { ...base.editor, clipRegions: [
			{ ...initial, endMs: 3000 },
			{ ...initial, id: "agent-cut", startMs: 3000, sourceStartMs: 3000 },
		], ...(agentHandoff ? { changeLog: { version: 1, entries: [oldCut, newCut] } } : {}) } };
		let diskRevision = "updated";
		let loadedAgentHistory = false;
		window.electronAPI.loadCurrentProjectFile = async () => ({ success: true, path, revision: "opened", project: base });
		window.electronAPI.openProjectFileAtPath = async (requestedPath, includeAgentHistory) => {
			document.documentElement.dataset.reloadedPath = requestedPath;
			const project = otherEdits && diskRevision === "agent-follow-up" ? { ...agent, editor: { ...agent.editor,
				autoCaptions: agent.editor.autoCaptions?.map(caption => ({ ...caption, text: caption.id === "caption-one"
					? "Agent final caption" : caption.id === "caption-two" ? "Original second caption" : caption.text })),
			} } : agent;
			if (timelineCut && includeAgentHistory && !loadedAgentHistory) {
				loadedAgentHistory = true;
				const afterCut = { ...agent, editor: { ...agent.editor, autoCaptionSettings: base.editor.autoCaptionSettings,
					autoCaptions: agent.editor.autoCaptions?.map(cue => cue.id === "caption-one" ? { ...cue, text: "Original caption" } : cue),
				} };
				return { success: true, path, revision: diskRevision, project, agentReviewHistory: [afterCut] };
			}
			return { success: true, path, revision: diskRevision, project };
		};
		window.electronAPI.releaseCurrentProject = async () => {
			document.documentElement.dataset.releasedProject = path;
			return { success: true, path };
		};
		if (agentHandoff) {
			window.electronAPI.setProjectAgentHandoff = async (_path, handedOff) => {
				document.documentElement.dataset.agentOwnsProject = String(handedOff);
				return { success: true };
			};
		}
		window.electronAPI.onProjectFileChanged = callback => {
			const receive = (event: Event) => {
				if (event instanceof CustomEvent && event.detail === "agent-follow-up") diskRevision = event.detail;
				callback({ path, diskRevision });
			};
			window.addEventListener("test-external-change", receive);
			return () => window.removeEventListener("test-external-change", receive);
		};
		window.electronAPI.saveProjectFile = async (project) => {
			const root = document.documentElement;
			if (otherEdits) {
				root.dataset.reviewSavedProject = JSON.stringify(project);
				return { success: true, path, revision: "reviewed" };
			}
			root.dataset.saveAttempts = String(Number(root.dataset.saveAttempts ?? 0) + 1);
			return { success: false, conflict: true, diskRevision: "updated" };
		};
		window.electronAPI.saveCutReviewHandoff = async (markdown) => {
			document.documentElement.dataset.reviewHandoff = markdown;
			return { success: true };
		};
		window.electronAPI.setHasUnsavedChanges = dirty => { document.documentElement.dataset.projectDirty = String(dirty); };
		window.electronAPI.saveProjectFileNamed = async (project, _name, _thumbnail, mode) => {
			const root = document.documentElement;
			root.dataset.savedCopyMode = mode;
			root.dataset.savedCopyHasCaption = String(JSON.stringify(project).includes("Keep my caption"));
			return { success: true, path: "/projects/Review copy.leadcut", projectId: "local-copy", revision: "copied" };
		};
	}, { agentHandoff, otherEdits, extraCaptionCount, captionCut });
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-region-id="screen"]')).toHaveCount(1, { timeout: 20000 });
	await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0, { timeout: 20000 });
}

test("Agent caption edits can be reviewed, reverted and annotated independently", async ({ page }) => {
	await openProjectForExternalChange(page, { agentHandoff: true, otherEdits: true });
	await page.getByRole("button", { name: "Hand off to Agent" }).click();
	await expect(page.locator("html")).toHaveAttribute("data-agent-owns-project", "true");
	await page.evaluate(() => window.dispatchEvent(new Event("test-external-change")));
	const appearance = page.locator('[data-agent-edit="autoCaptionSettings"]');
	const captions = page.locator('[data-agent-edit="autoCaptions"][data-agent-edit-item="caption-one"]');
	const secondCaption = page.locator('[data-agent-edit="autoCaptions"][data-agent-edit-item="caption-two"]');
	await expect(appearance).toContainText("Caption appearance");
	await expect(captions).toContainText("Caption text and timing");
	await expect(secondCaption).toContainText("Agent second caption");
	await page.getByRole("button", { name: "Resume editing" }).click();
	await expect(appearance).toHaveCount(1);
	await appearance.getByRole("button", { name: "Accept change" }).click();
	await expect(appearance).toContainText("Accepted");
	await secondCaption.getByRole("button", { name: "Accept change" }).click();
	await captions.getByRole("button", { name: "Note for Agent" }).click();
	await page.getByRole("textbox", { name: "Note for Agent" }).fill("Keep the original wording.");
	await page.getByRole("button", { name: "Save note" }).click();
	await page.getByRole("button", { name: /Export.*handoff/i }).click();
	await expect(page.locator("html")).toHaveAttribute("data-review-handoff", /Keep the original wording\./);
	await expect(page.locator("html")).toHaveAttribute("data-review-handoff", /"itemId": "caption-one"/);
	await captions.getByRole("button", { name: "Revert change" }).click();
	await expect(captions).toContainText("Restored");
	await expect(secondCaption).toContainText("Accepted");
	await page.keyboard.press("Control+s");
	await expect(page.locator("html")).toHaveAttribute("data-review-saved-project", /Original caption/);
	await expect(page.locator("html")).toHaveAttribute("data-review-saved-project", /Agent second caption/);
	await expect(page.locator("html")).toHaveAttribute("data-review-saved-project", /"fontSize":55/);
});

test("one Agent handoff reviews the net change to a caption across disk revisions", async ({ page }) => {
	await openProjectForExternalChange(page, { agentHandoff: true, otherEdits: true });
	const html = page.locator("html");
	await page.getByRole("button", { name: "Hand off to Agent" }).click();
	await expect(html).toHaveAttribute("data-agent-owns-project", "true");
	await page.evaluate(() => window.dispatchEvent(new Event("test-external-change")));
	const first = page.locator('[data-agent-edit-item="caption-one"]');
	const second = page.locator('[data-agent-edit-item="caption-two"]');
	await expect(first).toContainText("Agent caption");
	await expect(second).toContainText("Agent second caption");

	await page.evaluate(() => window.dispatchEvent(new CustomEvent("test-external-change", { detail: "agent-follow-up" })));
	await expect(first).toHaveCount(1);
	await expect(first).toContainText("Agent final caption");
	await expect(second).toHaveCount(0);
	await page.getByRole("button", { name: "Resume editing" }).click();
	await first.getByRole("button", { name: "Revert change" }).click();
	await expect(first).toContainText("Restored");
	await page.keyboard.press("Control+s");
	await expect(html).toHaveAttribute("data-review-saved-project", /Original caption/);
	await expect(html).toHaveAttribute("data-review-saved-project", /Original second caption/);
	await expect(html).toHaveAttribute("data-review-saved-project", /"fontSize":55/);
});

for (const captionCut of ["source", "timeline"]) {
	test(`coalesced Agent cuts and ${captionCut} captions can be reviewed separately`, async ({ page }) => {
		await openProjectForExternalChange(page, { agentHandoff: true, otherEdits: true, captionCut });
		const html = page.locator("html");
		await page.getByRole("button", { name: "Hand off to Agent" }).click();
		await expect(html).toHaveAttribute("data-agent-owns-project", "true");
		await page.evaluate(() => window.dispatchEvent(new Event("test-external-change")));
		const firstCaption = page.locator('[data-agent-edit-item="caption-one"]');
		const secondCaption = page.locator('[data-agent-edit-item="caption-two"]');
		const cut = page.locator('[data-review-entry="new-cut-log"]');
		await expect(cut).toHaveAttribute("data-review-latest", "true");
		await expect(firstCaption).toContainText("Agent caption");
		if (captionCut === "timeline") await expect(secondCaption).toHaveCount(0);
		else await expect(secondCaption).toContainText("Agent second caption");

		await page.getByRole("button", { name: "Resume editing" }).click();
		await cut.getByRole("button", { name: "Accept cut" }).click();
		await firstCaption.getByRole("button", { name: "Revert change" }).click();
		await expect(firstCaption).toContainText("Restored");
		await page.keyboard.press("Control+s");
		await expect.poll(() => html.evaluate(root => {
			const editor = JSON.parse(root.getAttribute("data-review-saved-project") ?? "{}").editor;
			return editor && {
				originalCaption: editor.autoCaptions[0].text,
				otherCaption: editor.autoCaptions[1].text,
				otherCaptionTime: [editor.autoCaptions[1].startMs, editor.autoCaptions[1].endMs],
				cutSource: editor.clipRegions[1]?.sourceStartMs,
				cutReviewed: editor.changeLog.entries[1].review,
			};
		})).toEqual({
			originalCaption: "Original caption", cutSource: 3200, cutReviewed: "accepted",
			otherCaption: captionCut === "timeline" ? "Original second caption" : "Agent second caption",
			otherCaptionTime: captionCut === "timeline" ? [3300, 4300] : [2400, 3600],
		});
	});
}

test("bulk Agent caption changes are all reachable without rendering the full list at once", async ({ page }) => {
	await openProjectForExternalChange(page, { agentHandoff: true, otherEdits: true, extraCaptionCount: 30 });
	await page.getByRole("button", { name: "Hand off to Agent" }).click();
	const html = page.locator("html");
	await expect(html).toHaveAttribute("data-agent-owns-project", "true");
	await page.evaluate(() => window.dispatchEvent(new Event("test-external-change")));
	const changes = page.getByRole("region", { name: "Other Agent changes" });
	await expect(changes.locator("[data-agent-edit]")).toHaveCount(24);
	await page.getByRole("button", { name: "Resume editing" }).click();
	const lastCaption = changes.locator('[data-agent-edit-item="caption-extra-29"]');
	await expect(lastCaption).toHaveCount(0);
	await changes.getByRole("button", { name: "Next change", exact: true }).click();
	await expect(lastCaption).toContainText("Agent extra caption 29");
	await expect(changes.getByRole("button", { name: "Next change", exact: true })).toBeDisabled();
	await changes.getByRole("button", { name: "Previous change", exact: true }).click();
	await expect(changes.locator('[data-agent-edit-item="caption-one"]')).toBeVisible();
});

test("Agent handoff releases editing, reloads a revision, then resumes desktop editing", async ({ page }) => {
	await openProjectForExternalChange(page, { agentHandoff: true });
	const documentState = page.locator("html");
	await page.getByRole("button", { name: "Hand off to Agent" }).click();
	await expect(documentState).toHaveAttribute("data-agent-owns-project", "true");
	await expect(page.getByText("Agent is editing this project.")).toBeVisible();
	await page.evaluate(() => window.dispatchEvent(new Event("test-external-change")));
	await expect(page.locator('[data-region-id="agent-cut"]')).toHaveCount(1);
	const recentCut = page.locator('[data-review-entry="new-cut-log"]');
	await expect(recentCut).toHaveAttribute("data-review-latest", "true");
	await expect(page.locator('[data-review-entry="old-cut-log"]')).not.toHaveAttribute("data-review-latest", "true");
	await expect(recentCut).toContainText("New this round");
	await page.getByRole("button", { name: "Resume editing" }).click();
	await expect(documentState).toHaveAttribute("data-agent-owns-project", "false");
	await expect(page.getByText("Agent is editing this project.")).toHaveCount(0);
	await expect(page.locator('[data-region-id="agent-cut"]')).toHaveCount(1);
	await expect(page.getByRole("button", { name: "Hand off to Agent" })).toBeEnabled();
	await expect(recentCut).toHaveAttribute("data-review-latest", "true");
	await page.evaluate(() => {
		window.electronAPI.saveProjectFile = async (data, _name, path) => {
			sessionStorage.setItem("test-agent-review", JSON.stringify(data));
			return { success: true, path, revision: "reviewed" };
		};
	});
	await recentCut.getByRole("button", { name: "Accept cut", exact: true }).click();
	await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("test-agent-review") ?? "{}")
		.editor?.changeLog?.entries.find((entry: { id: string }) => entry.id === "new-cut-log")?.review)).toBe("accepted");
});

test("reloads a clean project after an external update without resetting the playhead", async ({ page }) => {
	await openProjectForExternalChange(page);
	const timecode = page.getByRole("textbox", { name: "Timeline timecode", exact: true });
	await timecode.fill("00:00:02.000");
	await timecode.press("Enter");
	await expect(timecode).toHaveValue("00:00:02.000");
	await expect(page.locator("html")).toHaveAttribute("data-project-dirty", "false");
	await page.evaluate(() => window.dispatchEvent(new Event("test-external-change")));
	await expect(page.getByText("Project updated from disk", { exact: true })).toBeVisible();
	await expect(page.locator('[data-region-id="agent-cut"]')).toHaveCount(1);
	await expect(timecode).toHaveValue("00:00:02.000");
	await expect(page.locator("html")).not.toHaveAttribute("data-save-attempts");
});

test("Home releases project ownership and reads the disk version when dismissed", async ({ page }) => {
	await openProjectForExternalChange(page);
	const html = page.locator("html");
	await expect(html).toHaveAttribute("data-project-dirty", "false");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const library = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
	await expect(library).toBeVisible();
	await expect(html).toHaveAttribute("data-released-project", "/projects/Review.leadcut");
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(0);
	await page.waitForTimeout(1000);
	await expect(html).not.toHaveAttribute("data-save-attempts");
	await page.keyboard.press("Escape");
	await expect(html).toHaveAttribute("data-reloaded-path", "/projects/Review.leadcut");
	await expect(library).toHaveCount(0);
	await expect(page.locator('[data-region-id="agent-cut"]')).toHaveCount(1);
});

for (const saveCopy of [false, true]) {
	test(`suspends overwrite after an external edit and ${saveCopy ? "saves a local copy first" : "loads the disk version"}`, async ({ page }) => {
		await openProjectForExternalChange(page);
		await page.getByRole("button", { name: "Add caption", exact: true }).click();
		const transcript = page.getByRole("region", { name: "Caption transcript", exact: true });
		await transcript.locator("[data-caption-text]").click();
		const text = transcript.getByRole("textbox", { name: "Edit caption text", exact: true });
		await text.fill("Keep my caption");
		await text.press("Escape");
		await page.evaluate(() => window.dispatchEvent(new Event("test-external-change")));
		const conflict = page.getByRole("dialog", { name: "Project changed on disk", exact: true });
		const useDisk = conflict.getByRole("button", { name: "Use version on disk", exact: true });
		const copy = conflict.getByRole("button", { name: "Save my version as a copy", exact: true });
		await expect(useDisk).toBeVisible();
		await expect(copy).toBeVisible();
		const html = page.locator("html");
		const attempts = await html.getAttribute("data-save-attempts");
		await page.waitForTimeout(750);
		expect(await html.getAttribute("data-save-attempts")).toBe(attempts);
		if (saveCopy) {
			await copy.click();
			await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
			await expect(html).toHaveAttribute("data-saved-copy-mode", "copy");
			await expect(html).toHaveAttribute("data-saved-copy-has-caption", "true");
		} else {
			await useDisk.click();
		}
		await expect(html).toHaveAttribute("data-reloaded-path", "/projects/Review.leadcut");
		await expect(page.locator('[data-region-id="agent-cut"]')).toHaveCount(1);
		await expect(page.locator('[data-variant="caption"]')).toHaveCount(0);
	});
}
