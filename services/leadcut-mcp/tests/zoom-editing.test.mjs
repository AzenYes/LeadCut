import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

let client, dir, serial = 0;
const baseline = {
  version: 2, projectId: 'untouched-project', videoPath: 'source.mp4', futureTopLevel: { a: 1 },
  editor: {
    clipRegions: [{ id: 'clip-1', startMs: 2000, endMs: 9989, speed: 1 }],
    trimRegions: [], webcam: { enabled: true, sourcePath: 'webcam.mp4' },
    connectZooms: true, futureEditorOption: { preserve: true },
    zoomRegions: [
      { id: 'a', startMs: 1000, endMs: 2000, depth: 4, mode: 'auto', focus: { cx: 0.2, cy: 0.7, futureFocusField: true }, futureZoomOption: 10 },
      { id: 'b', startMs: 2000, endMs: 3000, depth: 3, mode: 'auto', focus: { cx: 0.4, cy: 0.5 } },
      { id: 'c', startMs: 3000, endMs: 5000, depth: 2, mode: 'manual', focus: { cx: 0.6, cy: 0.5 } },
    ],
  },
};
before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'leadcut-zoom-test-'));
  client = new Client({ name: 'zoom-editing-integration', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath,
    args: [path.resolve('dist/index.js')], env: { ...process.env, LEADCUT_USER_DATA_DIR: dir } }));
});
after(async () => { await client?.close(); if (dir) await fs.rm(dir, { recursive: true, force: true }); });
async function fixture() {
  const file = path.join(dir, `project-${serial++}.leadcut`);
  await fs.writeFile(file, JSON.stringify(baseline, null, 2));
  return file;
}
async function call(name, args, error = false) {
  if (['add_zoom','update_zoom','delete_zooms'].includes(name)) {
    const current = await call('open_project', {project:args.project});
    args = {dryRun:false, expectedRevision:current.revision, ...args};
  }
  const r = await client.callTool({ name, arguments: args });
  if (error) { assert.equal(r.isError, true, JSON.stringify(r)); return r; }
  assert.notEqual(r.isError, true, JSON.stringify(r));
  return JSON.parse(r.content[0].text);
}
async function read(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
test('MCP advertises zoom editing tools and sequence-time listing excludes touching boundaries', async () => {
  const tools = await client.listTools();
  for (const name of ['list_zooms', 'add_zoom', 'update_zoom', 'delete_zooms']) assert(tools.tools.some(t => t.name === name));
  const project = await fixture();
  const data = await call('list_zooms', { project, startMs: 2000, endMs: 3000 });
  assert.deepEqual(data.zoomRegions.map(r => r.id), ['b']);
  assert.equal(data.totalCount, 3);
  assert.equal(data.depthScales['1'], 1.25);
  assert.match(data.revision, /^[0-9a-f]{64}$/);
});
test('adds the next numeric zoom ID within the current sequence without overwriting unknown fields', async () => {
  const project = await fixture();
  const initial = await read(project);
  initial.editor.zoomRegions[0].id = 'zoom-8';
  await fs.writeFile(project, JSON.stringify(initial));
  const before = await fs.readFile(project, 'utf8');
  const span = { project, startMs: 5000, endMs: 6100 };
  const preview = await call('add_zoom', { ...span, dryRun: true });
  assert.deepEqual(preview.changes.added, {
    id: 'zoom-9', startMs: 5000, endMs: 6100, depth: 1, mode: 'auto', focus: { cx: 0.5, cy: 0.5 },
  });
  assert.equal(preview.backupPath, null);
  assert.equal(await fs.readFile(project, 'utf8'), before);
  const overlap = await call('add_zoom', { ...span, startMs: 4900 }, true);
  assert.match(overlap.content[0].text, /overlaps c \(3000–5000 ms\)/);
  const outside = await call('add_zoom', { ...span, endMs: 10_000 }, true);
  assert.match(outside.content[0].text, /duration \(9989 ms\)/);
  assert.equal(await fs.readFile(project, 'utf8'), before);
  const edited = await call('add_zoom', { ...span, depth: 3, mode: 'manual', focusX: 0.1, focusY: 0.8 });
  assert.equal(edited.changed, true);
  assert.equal(edited.matchedCount, 1);
  assert.equal(await fs.readFile(edited.backupPath, 'utf8'), before);
  const expected = structuredClone(initial);
  expected.editor.zoomRegions.push({ ...preview.changes.added, depth: 3, mode: 'manual', focus: { cx: 0.1, cy: 0.8 } });
  assert.deepEqual(await read(project), expected);
});
test('partial update preserves unknown fields and other tracks; backup is byte-identical', async () => {
  const project = await fixture();
  const before = await fs.readFile(project, 'utf8');
  const r = await call('update_zoom', { project, zoomId: 'a', depth: 1, focusX: 0.8, mode: 'manual' });
  assert.equal(r.changed, true);
  assert.equal(await fs.readFile(r.backupPath, 'utf8'), before);
  const expected = structuredClone(baseline);
  Object.assign(expected.editor.zoomRegions[0], { depth: 1, mode: 'manual' });
  expected.editor.zoomRegions[0].focus.cx = 0.8;
  assert.deepEqual(await read(project), expected);
});
test('invalid updates leave the project byte-identical', async () => {
  const project = await fixture();
  const before = await fs.readFile(project, 'utf8');
  for (const args of [
    { zoomId: 'missing', depth: 1 }, { zoomId: 'a' }, { zoomId: 'a', depth: 1.5 },
    { zoomId: 'a', depth: 0 }, { zoomId: 'a', focusY: 1.1 },
    { zoomId: 'a', startMs: 2100 }, { zoomId: 'a', endMs: -1 },
  ]) await call('update_zoom', { project, ...args }, true);
  assert.equal(await fs.readFile(project, 'utf8'), before);
});
test('dry run previews an update and deletion without writing or backups', async () => {
  const project = await fixture();
  const before = await fs.readFile(project, 'utf8');
  const update = await call('update_zoom', { project, zoomId: 'a', depth: 1, dryRun: true });
  assert.equal(update.changes.after.depth, 1);
  assert.equal(update.backupPath, null);
  const deletion = await call('delete_zooms', { project, startMs: 1900, endMs: 3100, dryRun: true });
  assert.equal(deletion.matchedCount, 3);
  assert.equal(deletion.backupPath, null);
  assert.equal(await fs.readFile(project, 'utf8'), before);
});
test('deletes exact IDs, rejecting mixed or missing selectors and unknown IDs', async () => {
  const project = await fixture();
  for (const args of [{}, { zoomIds: [] }, { startMs: 100 },
    { startMs: 2000, endMs: 2000 }, { zoomIds: ['a', 'unknown'] },
    { zoomIds: ['a'], startMs: 0, endMs: 4000 }]) {
    await call('delete_zooms', { project, ...args }, true);
    assert.deepEqual(await read(project), baseline);
  }
  const r = await call('delete_zooms', { project, zoomIds: ['a', 'c'] });
  assert.equal(r.matchedCount, 2);
  assert.deepEqual((await read(project)).editor.zoomRegions.map(z => z.id), ['b']);
  assert.deepEqual((await read(project)).editor.clipRegions, baseline.editor.clipRegions);
});
test('range supports contained or overlapping selection; empty result is a no-op', async () => {
  const project = await fixture();
  const preview = await call('delete_zooms', { project, startMs: 1900, endMs: 3100, match: 'contained', dryRun: true });
  assert.deepEqual(preview.changes.removed.map(r => r.id), ['b']);
  const r = await call('delete_zooms', { project, startMs: 1900, endMs: 3000 });
  assert.deepEqual(r.changes.removed.map(r => r.id), ['a', 'b']);
  const noMatch = await call('delete_zooms', { project, startMs: 6000, endMs: 7000 });
  assert.equal(noMatch.changed, false);
  assert.equal(noMatch.backupPath, null);
});
test('stale revisions reject writes and fresh sequential partial updates are preserved', async () => {
  const project = await fixture();
  const initial = await call('list_zooms', { project });
  await call('update_zoom', { project, zoomId: 'a', depth: 2, expectedRevision: initial.revision });
  await call('delete_zooms', { project, zoomIds: ['b'], expectedRevision: initial.revision }, true);
  await call('update_zoom', { project, zoomId: 'a', depth: 1 });
  await call('update_zoom', { project, zoomId: 'a', focusY: 0.1 });
  const a = (await read(project)).editor.zoomRegions[0];
  assert.equal(a.depth, 1);
  assert.equal(a.focus.cy, 0.1);
  assert.equal((await read(project)).editor.zoomRegions.length, 3);
});
