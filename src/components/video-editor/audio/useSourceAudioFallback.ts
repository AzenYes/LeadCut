import { useUiText } from "@/i18n/useUiText";
import { useEffect, useState } from "react";
import { toast } from "@/components/ui/toast";
import { SOURCE_AUDIO_FALLBACK_TOAST_ID } from "@/components/video-editor/audio/audioTypes";

interface UseSourceAudioFallbackParams {
	currentSourcePath: string | null;
	refreshKey?: number;
	summarizeErrorMessage: (message: string) => string;
}

const EMPTY_SOURCE_AUDIO = {
	sourceAudioFallbackPaths: [] as string[],
	sourceAudioSidecarPaths: [] as string[],
	sourceAudioFallbackStartDelayMsByPath: {} as Record<string, number>,
};

export function useSourceAudioFallback({
	currentSourcePath,
	refreshKey = 0,
	summarizeErrorMessage,
}: UseSourceAudioFallbackParams) {
	const uiText = useUiText();
	const [audio, setAudio] = useState<(typeof EMPTY_SOURCE_AUDIO & { sourcePath: string }) | null>(null);

	useEffect(() => {
		// Refetch when late recording sidecars are finalized after the editor opens.
		void refreshKey;
		setAudio(previous => previous?.sourcePath === currentSourcePath ? previous : null);
		if (!currentSourcePath) return;
		let cancelled = false;

		void (async () => {
			try {
				const result =
					await window.electronAPI.getVideoAudioFallbackPaths(currentSourcePath);
				if (cancelled) {
					return;
				}
				if (!result.success) {
					toast.warning(
						result.error
							? uiText("couldNotLoadCompanionAudioSourcesValue", { value0: summarizeErrorMessage(result.error) })
							: uiText("couldNotLoadCompanionAudioSourcesPlaybackAndExportMayMissMicrophoneAudio"),
						{ id: SOURCE_AUDIO_FALLBACK_TOAST_ID, duration: 10000 },
					);
					return;
				}

				toast.dismiss(SOURCE_AUDIO_FALLBACK_TOAST_ID);
				setAudio({
					sourcePath: currentSourcePath,
					sourceAudioFallbackPaths: result.paths ?? EMPTY_SOURCE_AUDIO.sourceAudioFallbackPaths,
					sourceAudioSidecarPaths: result.sidecarPaths ?? result.paths ?? EMPTY_SOURCE_AUDIO.sourceAudioSidecarPaths,
					sourceAudioFallbackStartDelayMsByPath: result.startDelayMsByPath ?? {},
				});
			} catch (error) {
				if (!cancelled) {
					toast.warning(
						uiText("couldNotLoadCompanionAudioSourcesValue", { value0: summarizeErrorMessage(String(error)) }),
						{ id: SOURCE_AUDIO_FALLBACK_TOAST_ID, duration: 10000 },
					);
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [uiText, currentSourcePath, refreshKey, summarizeErrorMessage]);

	return audio?.sourcePath === currentSourcePath ? audio : EMPTY_SOURCE_AUDIO;
}
