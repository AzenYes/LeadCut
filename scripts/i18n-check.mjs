import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const localesDir = path.join(root, "src", "i18n", "locales");

const locales = fs
	.readdirSync(localesDir)
	.filter((entry) => {
		const fullPath = path.join(localesDir, entry);
		return fs.statSync(fullPath).isDirectory();
	})
	.sort((left, right) => left.localeCompare(right));

if (!locales.includes("en")) {
	console.error('i18n-check: expected base locale directory "en"');
	process.exit(1);
}

function loadJson(filePath) {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`i18n-check: failed to load ${path.relative(root, filePath)}: ${message}`);
	}
}

function collectLeaves(obj, prefix = "", leaves = new Map()) {
	if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
		if (prefix) leaves.set(prefix, obj);
		return leaves;
	}

	const entries = Object.entries(obj);
	if (!entries.length && prefix) leaves.set(prefix, obj);

	for (const [key, value] of entries) {
		const nextPrefix = prefix ? `${prefix}.${key}` : key;
		collectLeaves(value, nextPrefix, leaves);
	}
	return leaves;
}

const baseLocaleDir = path.join(localesDir, "en");
const namespaceFiles = fs
	.readdirSync(baseLocaleDir)
	.filter((file) => file.endsWith(".json"))
	.sort((left, right) => left.localeCompare(right));

let hasErrors = false;
const coverage = new Map(locales.filter(locale => locale !== "en")
	.map(locale => [locale, { englishPhrases: 0, identical: 0 }]));

for (const namespaceFile of namespaceFiles) {
	const baseData = loadJson(path.join(baseLocaleDir, namespaceFile));
	const baseKeys = collectLeaves(baseData);

	for (const [locale, stats] of coverage) {
		const localeFile = path.join(localesDir, locale, namespaceFile);
		if (!fs.existsSync(localeFile)) {
			console.error(`i18n-check: missing namespace file ${locale}/${namespaceFile}`);
			hasErrors = true;
			continue;
		}

		const localeData = loadJson(localeFile);
		const localeKeys = collectLeaves(localeData);

		for (const [key, baseValue] of baseKeys) {
			if (!localeKeys.has(key)) {
				console.error(`i18n-check: missing key ${locale}/${namespaceFile}:${key}`);
				hasErrors = true;
			}
			if (typeof baseValue === "string" && /[A-Za-z]{3}/.test(baseValue)) {
				stats.englishPhrases++;
				if (localeKeys.get(key) === baseValue) stats.identical++;
			}
		}

		for (const key of localeKeys.keys()) {
			if (!baseKeys.has(key)) {
				console.error(`i18n-check: extra key ${locale}/${namespaceFile}:${key}`);
				hasErrors = true;
			}
		}
	}
}

for (const [locale, { englishPhrases, identical }] of coverage) {
	// Leave room for shared product names and terminology in supported translations.
	const limit = locale === "zh-CN" ? 5 : locale === "zh-TW" ? 50 : 70;
	const percent = englishPhrases ? (100 * identical) / englishPhrases : 0;
	const message = `i18n-check: ${locale} ${percent.toFixed(1)}% identical to English (limit ${limit}%)`;
	if (percent > limit) {
		console.error(message);
		hasErrors = true;
	} else console.log(message);
}

if (hasErrors) {
	process.exit(1);
}

console.log("i18n-check: locale files are structurally consistent");
