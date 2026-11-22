import fs from "node:fs/promises";

const metrics = {
	openToPlayableMs: "lower",
	waveformVisibleMs: "lower",
	peakMemoryMb: "lower",
	droppedFrameRatio: "lower",
	splitMs: "lower",
	rippleDeleteMs: "lower",
	scrollFps: "higher",
	exportSpeedX: "higher",
};

const [baselinePath, candidatePath] = process.argv.slice(2);
if (!baselinePath || !candidatePath)
	throw new Error(
		"Usage: node scripts/benchmark-leadcut-compare.mjs <baseline.json> <candidate.json>",
	);
const [baseline, candidate] = await Promise.all(
	[baselinePath, candidatePath].map(async (file) => JSON.parse(await fs.readFile(file, "utf8"))),
);
const candidates = new Map(candidate.runs.map((run) => [run.fixture, run]));
const rows = [];
for (const previous of baseline.runs) {
	const current = candidates.get(previous.fixture);
	if (!current) continue;
	for (const [metric, preference] of Object.entries(metrics)) {
		const before = previous[metric];
		const after = current[metric];
		if (!Number.isFinite(before) || !Number.isFinite(after))
			throw new Error(`Invalid metric ${metric} for ${previous.fixture}`);
		const delta = before === after ? 0 : ((after - before) / before) * 100;
		const regression = preference === "higher" ? delta < -20 : delta > 20;
		const change = Number.isFinite(delta)
			? `${delta > 0 ? "+" : ""}${delta.toFixed(2)}%`
			: "from zero";
		rows.push([
			previous.fixture,
			metric,
			before.toFixed(3),
			after.toFixed(3),
			change,
			regression ? "REGRESSION" : "",
		]);
	}
}
if (rows.length === 0) throw new Error("The reports have no matching fixtures");
console.log("| Fixture | Metric | Baseline | Candidate | Change | Flag |");
console.log("|---|---|---:|---:|---:|---|");
for (const row of rows) console.log(`| ${row.join(" | ")} |`);
