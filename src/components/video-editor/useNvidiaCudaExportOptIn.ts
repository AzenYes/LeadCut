import { NVIDIA_CUDA_EXPORT_OPT_IN_SETTING_KEY } from "@/lib/storageKeys";
import { useCallback, useEffect, useState } from "react";
import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";

export { NVIDIA_CUDA_EXPORT_OPT_IN_SETTING_KEY } from "@/lib/storageKeys";


type NativeExportCapabilitiesResult = {
	capabilities?: {
		nvidiaCuda?: {
			available?: boolean;
		};
	};
} | null;

export function isNvidiaCudaExportAvailable(result: NativeExportCapabilitiesResult | undefined) {
	return result?.capabilities?.nvidiaCuda?.available === true;
}

export function resolveNvidiaCudaExportOptIn(
	requested: boolean,
	nvidiaCudaExportAvailable: boolean,
) {
	return Boolean(requested && nvidiaCudaExportAvailable);
}

export function loadInitialNvidiaCudaExportOptIn() {
	return loadAppSetting<boolean>(NVIDIA_CUDA_EXPORT_OPT_IN_SETTING_KEY) === true;
}

export function saveNvidiaCudaExportOptIn(enabled: boolean) {
	return saveAppSetting(NVIDIA_CUDA_EXPORT_OPT_IN_SETTING_KEY, enabled);
}

export function useNvidiaCudaExportOptIn({
	exportMenuOpen,
	onEnabled,
}: { exportMenuOpen: boolean; onEnabled?: () => void }) {
	const [nvidiaCudaAvailability, setNvidiaCudaAvailability] = useState<boolean | null>(null);
	const [experimentalNvidiaCudaExport, setExperimentalNvidiaCudaExportState] = useState(
		loadInitialNvidiaCudaExportOptIn,
	);
	const nvidiaCudaExportAvailable = nvidiaCudaAvailability === true;
	const shouldCheckCapabilities = exportMenuOpen || experimentalNvidiaCudaExport;

	useEffect(() => {
		if (!shouldCheckCapabilities || nvidiaCudaAvailability !== null) return;
		let cancelled = false;

		void (async () => {
			try {
				const result = await window.electronAPI?.getNativeExportCapabilities?.();
				if (cancelled) {
					return;
				}

				const available = isNvidiaCudaExportAvailable(result);
				setNvidiaCudaAvailability(available);
				if (!available) {
					setExperimentalNvidiaCudaExportState(false);
				}
			} catch (error) {
				if (cancelled) {
					return;
				}
				console.warn("[export] Failed to load native export capabilities", error);
				setNvidiaCudaAvailability(false);
				setExperimentalNvidiaCudaExportState(false);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [nvidiaCudaAvailability, shouldCheckCapabilities]);

	const setExperimentalNvidiaCudaExport = useCallback(
		(enabled: boolean) => {
			const nextEnabled = resolveNvidiaCudaExportOptIn(enabled, nvidiaCudaExportAvailable);
			setExperimentalNvidiaCudaExportState(nextEnabled);
			saveNvidiaCudaExportOptIn(nextEnabled);
			if (nextEnabled) {
				onEnabled?.();
			}
		},
		[nvidiaCudaExportAvailable, onEnabled],
	);

	return {
		nvidiaCudaExportAvailable,
		experimentalNvidiaCudaExport,
		setExperimentalNvidiaCudaExport,
	};
}
