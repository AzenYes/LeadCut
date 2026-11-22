const warnedLegacyVariables = new Set<string>();

export function readAppEnv(suffix: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
	const currentKey = `LEADCUT_${suffix}`;
	if (env[currentKey] !== undefined) return env[currentKey];
	const legacyKey = `RECORDLY_${suffix}`;
	const value = env[legacyKey];
	if (value !== undefined && !warnedLegacyVariables.has(legacyKey)) {
		warnedLegacyVariables.add(legacyKey);
		console.warn(`[LeadCut] ${legacyKey} is deprecated. Use ${currentKey}.`);
	}
	return value;
}
