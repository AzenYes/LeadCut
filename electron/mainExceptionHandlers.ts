import type { appLog } from "./logger";

export function createMainExceptionHandlers({
	log,
	flush,
	notify,
}: {
	log: typeof appLog;
	flush: () => void;
	notify: () => Promise<void>;
}) {
	let notifying = false;

	function report(message: string, error: unknown) {
		log("error", "main-exception", message, error);
		flush();
	}

	return {
		onUncaughtException(error: Error, origin: NodeJS.UncaughtExceptionOrigin = "uncaughtException") {
			report(`Uncaught main-process exception (${origin}).`, error);
			if (notifying) return;
			notifying = true;
			void Promise.resolve().then(notify)
				.catch(error => report("Could not open the main-process error dialog.", error))
				.finally(() => { notifying = false; });
		},
		onUnhandledRejection(reason: unknown) {
			report("Unhandled main-process rejection.", reason);
		},
	};
}
