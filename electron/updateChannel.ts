export const STABLE_UPDATE_CHANNEL = "latest";
export const EXPERIMENTAL_UPDATE_CHANNEL = "beta";
export const EXPERIMENTAL_UPDATE_DESCRIPTION_KEY = "experimentalUpdateDescription";

export interface UpdateChannelConfiguration {
	channel: typeof STABLE_UPDATE_CHANNEL | typeof EXPERIMENTAL_UPDATE_CHANNEL;
	allowPrerelease: boolean;
	allowDowngrade: false;
}

export function getUpdateChannelConfiguration(
	experimentalUpdatesEnabled: boolean,
): UpdateChannelConfiguration {
	return {
		channel: experimentalUpdatesEnabled ? EXPERIMENTAL_UPDATE_CHANNEL : STABLE_UPDATE_CHANNEL,
		allowPrerelease: experimentalUpdatesEnabled,
		allowDowngrade: false,
	};
}

export function getNewerStableRelease(tag: unknown, currentVersion: string): string | null {
	if (typeof tag !== "string") throw new Error("GitHub did not provide a release tag.");
	const published = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag);
	const current = /^(\d+)\.(\d+)\.(\d+)(-[^+]+)?(?:\+.*)?$/.exec(currentVersion);
	if (!published || !current) throw new Error("Cannot compare the LeadCut release versions.");
	const version = published.slice(1).join(".");
	for (let part = 1; part <= 3; part++) {
		const difference = Number(published[part]) - Number(current[part]);
		if (difference !== 0) return difference > 0 ? version : null;
	}
	return current[4] ? version : null;
}
