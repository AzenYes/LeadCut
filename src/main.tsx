// Keep this import first so persisted settings are migrated before any reads.
import "./lib/legacyStorageMigration";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import { I18nProvider } from "./contexts/I18nContext.tsx";
import { ThemeProvider } from "./contexts/ThemeContext.tsx";
import { logError } from "./lib/appLog";
import { prepareStartupPreviewRenderer } from "./lib/startupEditorPreview";
import "./index.css";


document.documentElement.dataset.platform = /mac/i.test(navigator.platform) ? "macos" : "other";
window.addEventListener("error", event => logError("renderer", event.error ?? event.message));
window.addEventListener("unhandledrejection", event => logError("renderer", event.reason));
prepareStartupPreviewRenderer();

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<ThemeProvider>
			<I18nProvider>
				<App />
			</I18nProvider>
		</ThemeProvider>
	</React.StrictMode>,
);
