import { uiText } from "@/i18n/uiText";
export function summarizeErrorMessage(message: string): string {
	const firstLine = message
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line.length > 0);

	return firstLine ?? message;
}

export function cloneStructured<T>(value: T): T {
	return globalThis.structuredClone(value);
}

export function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error.replace(/^Error:\s*/i, "");
	return uiText("somethingWentWrong");
}
