import { toast } from "@/components/ui/toast";
import type { useUiText } from "@/i18n/useUiText";
import { moveProjectFolderReferences } from "../dashboard/useProjectFolders";

export function notifyProjectFormat(
	result: { path?: string; convertedFrom?: string; conversionFailed?: boolean },
	text: ReturnType<typeof useUiText>,
) {
	if (result.convertedFrom && result.path) {
		try {
			moveProjectFolderReferences(result.convertedFrom, result.path);
			toast.success(text("legacyProjectConverted"));
		} catch {
			toast.warning(text("projectRenamedButLibraryPreferencesCouldNotBeUpdated"));
		}
	} else if (result.conversionFailed) {
		toast.warning(text("legacyProjectConversionFailed"));
	}
}
