# LeadCut MCP

Local stdio MCP for the LeadCut editor in this repository. Based on Recordly MCP at commit `81f15a305d7181b623bb399d31c8586a49606867`; see NOTICE.md and LICENSE.md.

## Install and run

Requires Node.js 20+, FFmpeg and ffprobe. In this directory:

```powershell
npm ci
npm test
node scripts/call-tool.mjs get_paths
```

Configure Codex with an absolute path:

```toml
[mcp_servers.leadcut]
command = "node"
args = ["D:/办公程序/LeadCut/services/leadcut-mcp/dist/index.js"]
```

Restart or reconnect the client after adding the server. For the development profile set `LEADCUT_USER_DATA_DIR` to `%APPDATA%/LeadCut-dev`. The server also accepts `RECORDLY_USER_DATA_DIR` when the new variable is unset, and defaults to `%APPDATA%/LeadCut`. The profile's `recordings-settings.json` can set a custom recordings directory. Set `FFMPEG_PATH` and `FFPROBE_PATH` to override the binaries. Local ASR also needs Python, faster-whisper and an existing model.

## Editing contract

The server lists and reads `.leadcut` and legacy `.recordly` projects. When the name has no extension, it prefers the `.leadcut` project. New copies and mutation backups use `.leadcut`.

If LeadCut has the project open, return to Home to save and release it. Copy to Projects, read the revision and dry-run before writing with `expectedRevision`, then reopen the project in LeadCut. Backups preserve the original file bytes in `.mcp-backups`. Unknown project fields are preserved.

`cut_ranges` requires timelineModel `leadcut-sequence-v1` and explicit timeBasis `source` or `timeline`. Source time is the shared media clock. Timeline time is the current packed sequence. Source cuts apply to every repeated occurrence. Sequence order, speed, source bounds and per-clip audio settings survive splitting. Unlocked video tracks and external audio split and move with the same rules as the editor's F3 command. The result reports the changes per track and lists locked tracks separately. MCP intentionally keeps one continuous span for each surviving zoom and annotation across a cut. Editor F3 splits those effects. Imported timeline captions move with the cut and source captions retain source timestamps. The mapping contains both clocks. Wordless captions spanning cuts need content review.

Version-2 projects with packed clipRegions are supported. Legacy speedRegions, unnormalized gaps, overlapping clips and independent per-clip media paths are rejected. Open/save them in LeadCut or explicitly adapt the schema. Do not use the old Recordly source-time gap rules.

## Tools

- Projects and media use `get_paths`, `list_projects`, `open_project`, `copy_project`, `get_media_info` and `scan_frames`.
- `detect_silence` uses a 0.5-second minimum and a −30 dB threshold. The more permissive defaults may report more candidates. Review them against speech and actions before cutting.
- Sequence editing uses `cut_ranges`. `list_change_log` returns each cut with its current sequence position. `get_recording_markers` reads cut and highlight markers in source milliseconds.
- Zooms use `list_zooms`, `add_zoom`, `update_zoom` and `delete_zooms`. `add_zoom` rejects overlap and ranges past the sequence duration.
- Transcription uses `transcribe_audio`, `set_transcript` and `get_transcript`. The project transcript uses source milliseconds, preserves word timing flags and can be read over a source-time range. Importing a transcript preserves existing caption edits.
- Captions use `list_captions`, `set_captions`, `update_caption`, `delete_captions` and `update_caption_settings`. Caption style is supplied as explicit `settings` within the editor's accepted ranges.

Run `node scripts/call-tool.mjs --list` for exact schemas. Pass a JSON file with `--args-file request.json` to call a tool.

Captions use one clock per track. Source ASR results are seconds with delay already added. Native cues are milliseconds. Use LeadCut desktop to render and export. The companion **LeadCut视频剪辑** skill at `~/.codex/skills/leadcut-video-editing` includes native export and ASS workflow references.

### MP4 export

Set `LEADCUT_EXE` in the MCP server environment to the absolute path to a LeadCut build with agent export support. Call `export_project` with `project` and a new `.mp4` `outputPath`. The optional `quality` is `source` (default), `1080p`, `1440p`, or `2160p`. `fps` is `24`, `30` (default), or `60`. `timeoutSec` defaults to 1800. For a source checkout, `LEADCUT_EXPORT_DEV_APP` can point to the built app directory and `LEADCUT_EXE` to Electron.

The tool starts LeadCut with a temporary profile and project copy, preserving relative media links. It uses the editor’s encoder selection and returns `outputPath`, `durationMs`, `frameCount`, `width`, `height`, `frameRate`, `bitrate` (target video bitrate in bits per second), `encoderName`, and `route`. The tool checks the file and frame count before publishing. A failed export leaves the requested output path untouched. The server reports preflight problems that need a project change, such as stale chapters. The old smoke mode remains available for testing.

`get_key_events` reads the project source's `.leadcut-keys.json` events in source milliseconds. A missing sidecar returns an empty list. Windows records shortcuts and editing/navigation keys by default. Individual character keystrokes are available when the recording used the All keys setting.

The MCP transcription engine defaults to faster-whisper. Set `LEADCUT_ASR_ENGINE=qwen3-asr` or pass `engine: "qwen3-asr"` to use a locally installed Qwen script. Configure its paths with `LEADCUT_ASR_SCRIPT` and `LEADCUT_ASR_PYTHON`. Each engine uses existing local model weights. `set_transcript` imports the resulting JSON file, converts seconds to milliseconds and leaves the original audio offset in place.

## Native chapters

`list_chapters` returns the sequence duration, signature, confirmation status and revision. `set_chapters` accepts ordered, contiguous `{id?, title, startMs, endMs}` chapters covering the full sequence, `timelineModel: "leadcut-sequence-v1"`, optional style, and `confirmedByUser` (default false). Drafts remain disabled. Use `confirmedByUser: true` only after the human approves the exact names and boundaries, or call `confirm_chapters` after reviewing a stored draft. `update_chapter_style` adjusts reference-4K pixels, hex colors, opacity and visibility without changing captions. All mutations default to dryRun, require expectedRevision for writes, and create backups. Editing sequence timing, source order or speed makes confirmed chapters stale; review again before enabling/exporting. Chapters render through LeadCut native export, without an intermediate video overlay.
