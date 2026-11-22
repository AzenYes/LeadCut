import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

function findLegacyBrand(value: unknown, file: string, keys: string[] = []): string[] {
	if (typeof value === "string") {
		return /recordly/i.test(value) && !(file.endsWith("/settings.json") && keys[0] === "about")
			? [`${file} ${keys.join(".")}`]
			: [];
	}
	if (!value || typeof value !== "object") return [];
	return Object.entries(value).flatMap(([key, nested]) =>
		findLegacyBrand(nested, file, [...keys, key]),
	);
}

it("uses the LeadCut name in locale values and preserves upstream attribution in About", () => {
	const root = path.resolve("src/i18n/locales");
	const matches = fs.readdirSync(root).flatMap((locale) =>
		fs.readdirSync(path.join(root, locale))
			.filter((file) => file.endsWith(".json"))
			.flatMap((file) => findLegacyBrand(
				JSON.parse(fs.readFileSync(path.join(root, locale, file), "utf8")),
				`${locale}/${file}`,
			)),
	);
	expect(matches).toEqual([]);
	const settings = JSON.parse(fs.readFileSync(path.join(root, "en", "settings.json"), "utf8"));
	expect(settings.about.description).toMatch(/Recordly.+AGPL-3\.0/);
	expect(settings.about.upstreamLink).toBe("https://github.com/webadderallorg/Recordly");
});
