import { test, expect } from '@playwright/test';
import { installDesktopBridge } from './bridge';

test.beforeEach(async ({ page }) => {
    await installDesktopBridge(page, 'waveform.mp4');
    await page.addInitScript(() => {
      localStorage.setItem('leadcut.locale', 'en');
      window.electronAPI.getPlatform = async () => 'win32';
      window.electronAPI.getWindowChrome = async () => ({ trafficLightsVisible: false });
      window.electronAPI.getLocalMediaUrl = async () => ({ success: true, url: `${location.origin}/tests/ui/fixtures/waveform.mp4` });
      window.audit = { saves: [], creates: [], trashed: [] };
			window.electronAPI.onMenuSaveProject = handler => { window.audit.requestSave = handler; return () => undefined; };
      const current = '/projects/Audit.leadcut';
      let entries = [{ path: current, name: 'Audit', updatedAt: Date.now(), isCurrent: true, thumbnailPath: null, isInProjectsDirectory: true }];
      const project = { version: 2, projectId: 'audit', videoPath: '/audit/waveform.mp4', editor: { clipRegions: [{ id: 'screen', startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 }], sourceAudioTrackSettingsByClip: { screen: { mixed: { volume: 0.2, normalize: true } } } } };
      window.electronAPI.getWhisperSmallModelStatus = async () => ({ success: true, exists: true, path: '/models/audit.bin' });
      window.electronAPI.loadCurrentProjectFile = async () => ({ success: true, path: current, project });
      window.electronAPI.saveProjectFile = async (data, name, target) => { window.audit.saves.push({ data, target }); return { success: true, path: target ?? '/projects/Copy.leadcut', projectId: data.projectId }; };
      window.electronAPI.createProjectFile = async (data) => { window.audit.creates.push(data); return { success: true, path: '/projects/Recreated.leadcut', projectId: 'recreated' }; };
      window.electronAPI.listProjectFiles = async () => ({ success: true, projects: [], entries });
      window.electronAPI.trashProjectFiles = async (paths) => { window.audit.trashed.push(...paths); entries = entries.filter(e => !paths.includes(e.path)); return { success: true, deleted: paths, errors: [] }; };
    });
    await page.goto('/?windowType=editor', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await expect(page.locator('[data-region-id="screen"]')).toHaveCount(1, { timeout: 30000 });
    await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('video')].some(video => video.readyState >= 2))).toBe(true);
    await expect(page.getByLabel('Loading preview', { exact: true })).toHaveCount(0);
    await page.waitForTimeout(600);
});

async function split(page) {
  await page.getByRole('textbox', { name: 'Timeline timecode' }).fill('00:00:02.000');
  await page.getByRole('textbox', { name: 'Timeline timecode' }).press('Enter');
  await expect(page.getByRole('textbox', { name: 'Timeline timecode' })).toHaveValue('00:00:02.000');
  await page.keyboard.press('F2');
  await expect(page.locator('[data-variant="clip"][data-region-id]')).toHaveCount(2);
}
async function savedEditor(page) {
  await expect.poll(() => page.evaluate(() => window.audit.saves.length)).toBeGreaterThan(0);
  return page.evaluate(() => window.audit.saves.at(-1).data.editor);
}

test('B2: splitting inherits source audio, including undo and redo', async ({ page }) => {
  await split(page);
  await expect.poll(async () => (await savedEditor(page)).clipRegions.length).toBe(2);
  const settings = { mixed: { volume: 0.2, normalize: true } };
  let editor = await savedEditor(page);
  for (const clip of editor.clipRegions) expect(editor.sourceAudioTrackSettingsByClip[clip.id]).toEqual(settings);
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-variant="clip"][data-region-id]')).toHaveCount(1);
  await expect.poll(async () => (await savedEditor(page)).clipRegions.length).toBe(1);
  expect((await savedEditor(page)).sourceAudioTrackSettingsByClip.screen).toEqual(settings);
  await page.keyboard.press('Control+y');
  await expect.poll(async () => (await savedEditor(page)).clipRegions.length).toBe(2);
  editor = await savedEditor(page);
  for (const clip of editor.clipRegions) expect(editor.sourceAudioTrackSettingsByClip[clip.id]).toEqual(settings);
});

test('B3: a delayed transcript cannot replace captions in a same-source project', async ({ page }) => {
  await page.evaluate(() => {
    window.electronAPI.generateAutoCaptions = () => new Promise(resolve => {
      window.finishAuditCaptions = () => resolve({ success: true, cues: [{ id: 'generated-for-A', startMs: 0, endMs: 1500, text: 'Transcript from project A' }] });
    });
    window.electronAPI.loadProjectFile = async () => ({ success: true, path: '/projects/ProjectB.leadcut', project: { version: 2, projectId: 'B', videoPath: '/audit/waveform.mp4', editor: { clipRegions: [{ id: 'B-clip', startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 }], autoCaptions: [{ id: 'B-caption', startMs: 0, endMs: 1500, text: 'Manually edited project B' }], autoCaptionSettings: { enabled: true } } } });
  });
  await page.getByRole('radio', { name: 'Captions', exact: true }).click();
  await page.getByRole('button', { name: 'Generate Captions', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof window.finishAuditCaptions)).toBe('function');
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await expect(page.locator('[data-region-id="B-clip"]')).toHaveCount(1);
  await page.evaluate(() => window.finishAuditCaptions());
  await expect(page.getByText('Manually edited project B', { exact: true }).first()).toBeVisible();
  await page.getByRole('radio', { name: 'Scene', exact: true }).click();
  const blur = page.getByRole('slider', { name: 'Blur', exact: true });
  await blur.press('ArrowRight');
  await blur.blur();
  const editor = await savedEditor(page);
  expect(editor.autoCaptions.map(c => c.text)).toEqual(['Manually edited project B']);
});

test('B4: dashboard and body focus block editor undo, redo, split and playback', async ({ page }) => {
  await split(page);
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'Audit', exact: true }).focus();
  for (const key of ['Control+z', 'Control+y', 'Space', 'l', 'F2', 'F3']) await page.keyboard.press(key);
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('dialog', { name: 'Projects dashboard' })).toBeVisible();
  await page.evaluate(() => {
    window.electronAPI.openProjectFileAtPath = async path => ({
      success: true, path, project: window.audit.saves.at(-1).data,
    });
  });
  await page.getByRole('button', { name: 'Audit', exact: true }).dblclick();
  await expect(page.getByRole('dialog', { name: 'Projects dashboard' })).toBeHidden();
  await expect(page.locator('[data-variant="clip"][data-region-id]')).toHaveCount(2);
  expect(await page.evaluate(() => [...document.querySelectorAll('video')].filter(v => !v.paused && !v.muted).length)).toBe(0);
});

test('B5: deleting the active project drains a pending save and never recreates it', async ({ page }) => {
  await page.evaluate(() => {
    const save = window.electronAPI.saveProjectFile;
    const trash = window.electronAPI.trashProjectFiles;
    window.audit.order = [];
    window.electronAPI.saveProjectFile = async (...args) => {
      window.audit.order.push('save-start');
      if (!window.audit.finishSave)
        await new Promise(resolve => { window.audit.finishSave = resolve; });
      const result = await save(...args);
      window.audit.order.push('save-end');
      return result;
    };
    window.electronAPI.trashProjectFiles = async paths => { window.audit.order.push('trash'); return trash(paths); };
  });
  await split(page);
  await expect.poll(() => page.evaluate(() => typeof window.audit.finishSave)).toBe('function');
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Projects dashboard' })).toBeVisible();
  expect(await page.evaluate(() => window.audit.trashed)).toEqual([]);
  await page.evaluate(() => window.audit.finishSave());
  await expect(page.getByRole('button', { name: 'Audit', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Options for Audit', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete project', exact: true }).click();
  await page.getByRole('button', { name: 'Move to Recycle Bin', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.audit.trashed)).toEqual(['/projects/Audit.leadcut']);
  await page.waitForTimeout(1600); // More than three autosave intervals.
  expect(await page.evaluate(() => window.audit.creates.length)).toBe(0);
  const order = await page.evaluate(() => window.audit.order);
  expect(order.slice(0, 2)).toEqual(['save-start', 'save-end']);
  expect(order.at(-1)).toBe('trash');
  await expect(page.locator('[data-variant="clip"][data-region-id]')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Projects dashboard' })).toBeVisible();
});

test('B6: appearance edits undo/redo; a slider drag is one undo step', async ({ page }) => {
  const blur = page.getByRole('slider', { name: 'Blur', exact: true });
  const before = await blur.inputValue();
  await blur.focus(); await page.keyboard.press('ArrowRight'); await blur.blur();
  const changed = await blur.inputValue();
  expect(changed).not.toBe(before);
  await page.keyboard.press('Control+z');
  await expect(blur).toHaveValue(before);
  await page.keyboard.press('Control+y');
  await expect(blur).toHaveValue(changed);
  const box = await blur.locator('xpath=ancestor::*[@data-slot="slider-track"]').boundingBox();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up(); await blur.blur();
  const dragged = await blur.inputValue();
  expect(dragged).not.toBe(changed);
  await page.keyboard.press('Control+z');
  await expect(blur).toHaveValue(changed);
  await page.keyboard.press('Control+y');
  await expect(blur).toHaveValue(dragged);
});

for (const failure of ['missing', 'corrupt', 'media']) {
  test(`B7: ${failure} project open failure preserves the current editor and history`, async ({ page }) => {
    await split(page);
    await page.evaluate(failure => {
      if (failure === 'missing') window.electronAPI.loadProjectFile = async () => ({ success: false, error: 'AUDIT: file missing' });
      if (failure === 'corrupt') window.electronAPI.loadProjectFile = async () => ({ success: true, project: {} });
      if (failure === 'media') {
        window.electronAPI.loadProjectFile = async () => ({ success: true, path: '/projects/B.leadcut', project: { version: 2, videoPath: '/missing/video.mp4', editor: {} } });
        window.electronAPI.setCurrentVideoPath = async () => ({ success: false });
      }
    }, failure);
    await page.getByRole('button', { name: 'Open project', exact: true }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(page.locator('.editor-header')).toBeVisible();
    await expect(page.locator('[data-variant="clip"][data-region-id]')).toHaveCount(2);
    await page.keyboard.press('Control+z');
    await expect(page.locator('[data-variant="clip"][data-region-id]')).toHaveCount(1);
  });
}

test('B8: stale enabled chapters can be disabled and remain off after saving', async ({ page }) => {
  await page.getByRole('radio', { name: 'Chapters', exact: true }).click();
  await page.getByRole('button', { name: 'Add chapter at playhead', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm chapters and enable', exact: true }).click();
  await split(page);
  const checkbox = page.getByRole('checkbox', { name: 'Show chapter progress', exact: true });
  await expect(checkbox).toBeChecked();
  await expect(checkbox).toBeEnabled();
  await checkbox.uncheck();
  await expect.poll(async () => (await savedEditor(page)).chapterProgress.enabled).toBe(false);
});

test('B9: library errors retain cached entries and can be retried', async ({ page }) => {
  const home = page.getByRole('button', { name: 'Home', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Projects dashboard' });
  const project = dialog.getByRole('button', { name: 'Audit', exact: true });
  await page.evaluate(() => {
    window.electronAPI.openProjectFileAtPath = window.electronAPI.loadCurrentProjectFile;
  });
  await home.click();
  await expect(project).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Search projects', exact: true }).press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => { window.audit.list = window.electronAPI.listProjectFiles; window.electronAPI.listProjectFiles = async () => ({ success: false, error: 'AUDIT: disk unavailable' }); });
  await home.click();
  await expect(dialog.getByRole('alert')).toContainText('AUDIT: disk unavailable');
  await expect(dialog.getByRole('button', { name: 'Audit', exact: true })).toBeVisible();
  await page.evaluate(() => { window.electronAPI.listProjectFiles = window.audit.list; });
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Audit', exact: true })).toBeVisible();
});

test('B6: caption style, camera appearance, and crop edits can be undone', async ({ page }) => {
  test.setTimeout(60000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('radio', { name: 'Captions', exact: true }).click();
  const outline = page.getByRole('slider', { name: 'Outline width', exact: true });
  const original = await outline.inputValue();
  await outline.focus(); await page.keyboard.press('ArrowRight'); await outline.blur();
  const edited = await outline.inputValue();
  expect(edited).not.toBe(original);
  await page.keyboard.press('Control+z'); await expect(outline).toHaveValue(original);
  await page.keyboard.press('Control+y'); await expect(outline).toHaveValue(edited);
  await page.getByRole('radio', { name: 'Webcam', exact: true }).click();
  const camera = page.getByRole('slider', { name: 'Webcam Scale', exact: true });
  const cameraBefore = await camera.inputValue();
  await camera.focus(); await page.keyboard.press('ArrowRight'); await camera.blur();
  expect(await camera.inputValue()).not.toBe(cameraBefore);
  await page.keyboard.press('Control+z'); await expect(camera).toHaveValue(cameraBefore);
  await page.getByRole('radio', { name: 'Scene', exact: true }).click();
  await page.getByRole('button', { name: 'Crop Video', exact: true }).click();
  const crop = page.getByRole('dialog', { name: 'Crop Video', exact: true });
  const topHandle = crop.locator('.cursor-ns-resize').first();
  await topHandle.hover();
  const top = await topHandle.boundingBox();
  await page.mouse.move(top.x + top.width / 2, top.y + top.height / 2);
  await page.mouse.down(); await page.mouse.move(top.x + top.width / 2, top.y + 50, { steps: 10 }); await page.mouse.up();
  await expect.poll(() => topHandle.evaluate(handle => parseFloat(handle.style.top))).toBeGreaterThan(0);
  await crop.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(crop).toHaveCount(0);
  await expect.poll(async () => (await savedEditor(page)).cropRegion.y).toBeGreaterThan(0);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await savedEditor(page)).cropRegion.y).toBe(0);
  await page.getByRole('button', { name: 'Crop Video', exact: true }).click();
  await expect(crop).toBeVisible();
  await crop.locator('.cursor-ns-resize').first().hover();
  const cancelTop = await crop.locator('.cursor-ns-resize').first().boundingBox();
  await page.mouse.move(cancelTop.x + cancelTop.width / 2, cancelTop.y + 1);
  await page.mouse.down(); await page.mouse.move(cancelTop.x + cancelTop.width / 2, cancelTop.y + 30, { steps: 5 }); await page.mouse.up();
  await page.keyboard.press('Escape');
  await expect(crop).toHaveCount(0);
  // Cancelling must retain the redo entry for the previous committed crop.
  await page.keyboard.press('Control+y');
  await expect.poll(async () => (await savedEditor(page)).cropRegion.y).toBeGreaterThan(0);
});

test('B9: first library failure is not presented as an empty project library', async ({ page }) => {
  await page.addInitScript(() => {
    window.electronAPI.listProjectFiles = async () => ({ success: false, error: 'AUDIT: permission denied' });
  });
  await page.reload();
  await expect(page.locator('[data-region-id="screen"]')).toHaveCount(1, { timeout: 30000 });
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Projects dashboard' });
  await expect(dialog.getByRole('alert')).toContainText('AUDIT: permission denied');
  await expect(dialog.getByText("It's looking empty in here...", { exact: true })).toHaveCount(0);
  // Opening Home saves a thumbnail before refreshing the library. Keep the
  // failure injected until that refresh finishes, so Retry remains actionable.
  await expect(dialog.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled();
  await page.evaluate(() => { window.electronAPI.listProjectFiles = async () => ({ success: true, entries: [], projects: [] }); });
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByText("It's looking empty in here...", { exact: true })).toBeVisible();
});
