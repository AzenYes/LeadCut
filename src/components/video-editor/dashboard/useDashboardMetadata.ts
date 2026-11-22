import { readRendererSetting, writeRendererSetting } from "@/lib/durableRendererSettings";
import { DASHBOARD_METADATA_STORAGE_KEY } from "@/lib/storageKeys";
import { useUiText } from "@/i18n/useUiText";
import { useState } from "react";
import { toast } from "@/components/ui/toast";

type Metadata = { colors: string[] };
function load(): Metadata {
	try {
		const value = JSON.parse(readRendererSetting(DASHBOARD_METADATA_STORAGE_KEY) || "{}");
		return {
			colors: Array.isArray(value.colors)
				? value.colors.filter(
						(c: unknown) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c),
					)
				: [],
		};
	} catch {
		return { colors: [] };
	}
}
export function useDashboardMetadata() {
	const uiText = useUiText();
	const [metadata, setMetadata] = useState(load);
	const update = (next: Metadata) => {
		try {
			writeRendererSetting(DASHBOARD_METADATA_STORAGE_KEY, JSON.stringify(next));
			setMetadata(next);
		} catch {
			toast.error(uiText("couldNotSaveLibraryPreferences"));
		}
	};
	return { metadata, update };
}
