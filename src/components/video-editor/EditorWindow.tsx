import { useEffect } from "react";
import { ShortcutsProvider } from "../../contexts/ShortcutsContext";
import { loadAllCustomFonts } from "../../lib/customFonts";
import { listLocalFontFamilies } from "../../lib/localFonts";
import { ShortcutsConfigDialog } from "./ShortcutsConfigDialog";
import VideoEditor from "./VideoEditor";

export default function EditorWindow() {
	useEffect(() => {
		loadAllCustomFonts().catch((error) => {
			console.error("Failed to load custom fonts:", error);
		});
		if (typeof window.electronAPI?.listLocalFontFamilies === "function") {
			void listLocalFontFamilies().catch(() => undefined);
		}
	}, []);

	return (
		<>
			<ShortcutsProvider>
				<VideoEditor />
				<ShortcutsConfigDialog />
			</ShortcutsProvider>
		</>
	);
}
