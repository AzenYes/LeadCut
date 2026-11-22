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
      const originalGetSetting = window.electronAPI.getAppSetting;
      window.electronAPI.getAppSetting = key => key === 'leadcut.editor.layout.v1' ? JSON.parse(localStorage.getItem(key) || 'null') : originalGetSetting(key);
      window.electronAPI.setAppSetting = (key, value) => { if (key === 'leadcut.editor.layout.v1') localStorage.setItem(key, JSON.stringify(value)); return true; };
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

async function savedEditor(page) {
  await expect.poll(() => page.evaluate(() => window.audit.saves.length)).toBeGreaterThan(0);
  return page.evaluate(() => window.audit.saves.at(-1).data.editor);
}

async function editBlur(page) {
  const slider = page.getByRole('slider', { name: 'Blur', exact: true });
  await slider.focus(); await page.keyboard.press('ArrowRight'); await slider.blur();
}

test('D1: saved state follows disk completion and subsequent edits', async ({ page }) => {
  const status = page.locator('[data-save-state]');
  await expect(status).toHaveAttribute('data-save-state', 'saved', {timeout:30000});
  await page.evaluate(() => {
    const save = window.electronAPI.saveProjectFile;
    window.audit.pending = [];
    window.audit.saveStates = [];
    new MutationObserver(() => window.audit.saveStates.push(document.querySelector('[data-save-state]')?.dataset.saveState)).observe(document.querySelector('[data-save-state]'), {attributes:true,attributeFilter:['data-save-state']});
    window.electronAPI.saveProjectFile = (...args) => new Promise(resolve => window.audit.pending.push(async () => resolve(await save(...args))));
  });
  await editBlur(page);
  await expect.poll(() => page.evaluate(() => window.audit.saveStates.includes('pending'))).toBe(true);
  await expect(status).toHaveAttribute('data-save-state', 'saving');
  await editBlur(page);
  await page.waitForTimeout(600);
  await page.evaluate(() => window.audit.pending[0]());
  await expect.poll(() => page.evaluate(() => window.audit.pending.length)).toBe(2);
  await expect(status).toHaveAttribute('data-save-state', 'saving');
  await page.evaluate(() => window.audit.pending[1]());
  await expect(status).toHaveAttribute('data-save-state', 'saved', {timeout:30000});
  await expect(status.locator('[title]')).toHaveAttribute('title', /Last saved at/);
  const saved = await savedEditor(page);
  expect(saved.backgroundBlur).toBeGreaterThan(0);
});

test('D1: a save failure persists, retry recovers without losing edits', async ({ page }) => {
  await page.evaluate(() => { window.audit.originalSave = window.electronAPI.saveProjectFile; window.audit.failedCalls = 0; window.electronAPI.saveProjectFile = async () => { window.audit.failedCalls++; return { success: false, message: 'Disk is read only' }; }; });
  await editBlur(page);
  const status = page.locator('[data-save-state]');
  await expect(status).toHaveAttribute('data-save-state', 'failed');
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => window.audit.failedCalls)).toBe(1);
  await page.getByRole('button', { name: 'Save failed', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save failed', exact: true });
  await expect(dialog).toContainText('Disk is read only');
  await expect(dialog.getByRole('button', { name: 'Save As', exact: true })).toBeVisible();
  await page.evaluate(() => { window.electronAPI.saveProjectFile = window.audit.originalSave; });
  await dialog.getByRole('button', { name: 'Retry save', exact: true }).click();
  await expect(status).toHaveAttribute('data-save-state', 'saved', {timeout:30000});
  expect((await savedEditor(page)).backgroundBlur).toBeGreaterThan(0);
});

test('D1: failed autosave can recover via Save As', async ({ page }) => {
  await page.evaluate(() => { const save = window.electronAPI.saveProjectFile; window.electronAPI.saveProjectFile = async (data,name,target,...rest) => target ? { success:false,message:'Disk unavailable' } : save(data,name,target,...rest); });
  await editBlur(page);
  await page.getByRole('button', { name: 'Save failed', exact: true }).click();
  await page.getByRole('dialog', { name: 'Save failed', exact: true }).getByRole('button', { name: 'Save As', exact: true }).click();
  await expect(page.locator('[data-save-state]')).toHaveAttribute('data-save-state','saved',{timeout:30000});
  await expect.poll(() => page.evaluate(() => window.audit.saves.at(-1)?.target)).toBeUndefined();
  expect((await savedEditor(page)).backgroundBlur).toBeGreaterThan(0);
});

async function requestDelete(page) {
  await page.getByRole('button', { name: 'Options for Audit', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete project', exact: true }).click();
  return page.getByRole('dialog', { name: 'Confirm deletion', exact: true });
}

test('D2: deletion requires confirmation; cancel and Escape leave the project intact', async ({ page }) => {
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  let dialog = await requestDelete(page);
  await expect(dialog).toContainText('Audit');
  await expect(dialog).toContainText('Referenced video and audio files will be kept');
  await expect(dialog).toContainText('current project');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.audit.trashed)).toEqual([]);
  dialog = await requestDelete(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.audit.trashed)).toEqual([]);
  dialog = await requestDelete(page);
  await dialog.getByRole('button', { name: 'Move to Recycle Bin', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.audit.trashed)).toEqual(['/projects/Audit.leadcut']);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(/To recover, restore them there/)).toBeVisible();
});

test('D2: bulk partial failure retains only failed names for retry', async ({ page }) => {
  await page.evaluate(() => {
    window.electronAPI.listProjectFiles = async () => ({success:true,entries:['Audit','Other'].map(name=>({name,path:`/projects/${name}.leadcut`,isCurrent:name==='Audit',updatedAt:Date.now(),thumbnailPath:null,isInProjectsDirectory:true}))});
    window.electronAPI.trashProjectFiles = async paths => { window.audit.trashed.push(...paths); return {success:false,deleted:paths.filter(p=>p.includes('Other')),errors:['Permission denied: Audit']}; };
  });
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('button', {name:'Other',exact:true})).toBeVisible({timeout:30000});
  await page.getByRole('button', { name: 'Select projects to delete', exact: true }).click();
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm deletion', exact: true });
  await expect(dialog).toContainText('2 project');
  await dialog.getByRole('button', { name: 'Move to Recycle Bin', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('1 item(s)');
  await expect(dialog.getByRole('list')).toHaveText('Audit');
  await page.evaluate(() => { window.electronAPI.trashProjectFiles = async paths => ({success:true,deleted:paths,errors:[]}); });
  await dialog.getByRole('button', { name: 'Move to Recycle Bin', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('D3/D4: collapse, keyboard/drag resize, labels and persistence', async ({ page }) => {
  const inspector = page.locator('#editor-inspector');
  const width = page.getByRole('separator', { name: 'Inspector width', exact: true });
  await expect(inspector).toBeVisible();
  await width.focus(); await page.keyboard.press('ArrowRight');
  await expect(width).toHaveAttribute('aria-valuenow','330');
  const handle = await width.boundingBox();
  await page.mouse.move(handle.x+3,handle.y+50); await page.mouse.down(); await page.mouse.move(handle.x+63,handle.y+50,{steps:6}); await page.mouse.up();
  const resized = Number(await width.getAttribute('aria-valuenow'));
  expect(resized).toBeGreaterThan(370);
  await page.getByRole('button', { name: 'Show tool names', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Chapters', exact: true })).toHaveText('Chapters');
  const chapterIcon = await page.getByRole('radio', { name: 'Chapters', exact: true }).locator('svg').innerHTML();
  const captionIcon = await page.getByRole('radio', { name: 'Captions', exact: true }).locator('svg').innerHTML();
  expect(chapterIcon).not.toEqual(captionIcon);
  await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click();
  await expect(inspector).toBeHidden();
  await page.reload();
  await expect(page.locator('.boot-shell')).toHaveCount(0, { timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Show tool names', exact: true })).toHaveAttribute('aria-pressed','true');
  await expect(inspector).toBeHidden();
  await page.getByRole('button', { name: 'Expand inspector', exact: true }).click();
  await expect(width).toHaveAttribute('aria-valuenow',String(resized));
});

test('D3: compact viewport preserves title and primary actions; inspector overlays preview', async ({ page }) => {
  await page.setViewportSize({width:800,height:600});
  const inspector=page.locator('#editor-inspector');
  await expect(inspector).toBeHidden();
  await expect(page.getByRole('button', { name: 'Rename project', exact:true })).toBeVisible();
  const title=await page.locator('.editor-header-title').boundingBox();
  expect(title.width).toBeGreaterThanOrEqual(90);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'More actions',exact:true}).click();
  await expect(page.getByRole('menuitem',{name:'Open project',exact:true})).toBeVisible();
  await expect(page.getByRole('menuitem',{name:'Save As',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('radio',{name:'Captions',exact:true}).click();
  await expect(inspector).toBeVisible();
  const box=await inspector.boundingBox(); expect(box.x+box.width).toBeLessThanOrEqual(800);
  await inspector.getByRole('button',{name:'Collapse inspector',exact:true}).click();
  await expect(inspector).toBeHidden();
  await page.screenshot({path:'.code/ux-fix/compact-800.png'});
});

