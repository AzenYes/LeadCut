import { uiText } from "@/i18n/uiText";
import { Toast, toast as heroToast } from "@heroui/react";
import { isValidElement, type ReactNode } from "react";
import { localizeUiMessage } from "@/i18n/uiText";
import { useUiText } from "@/i18n/useUiText";

type Options = {
	id?: string | number;
	description?: ReactNode;
	duration?: number;
	action?: { label: ReactNode; onClick: () => void };
	onDismiss?: () => void;
};
type Variant = "default" | "accent" | "success" | "warning" | "danger";
const ids = new Map<string | number, string>();

function plainText(value: ReactNode): string {
	if (typeof value === "string" || typeof value === "number") return String(value);
	if (Array.isArray(value)) return value.map(plainText).join("");
	if (isValidElement<{ children?: ReactNode }>(value)) return plainText(value.props.children);
	return "";
}

// Keep existing callers compatible while HeroUI owns the queue and presentation.
function notify(title: ReactNode, options: Options = {}, variant: Variant = "default") {
	if (typeof title === "string") title = localizeUiMessage(title);
	if (typeof options.description === "string") {
		options = { ...options, description: localizeUiMessage(options.description) };
	}
	const errorText = [plainText(title), plainText(options.description)]
		.filter(Boolean)
		.join("\n\n");
	const action = options.action;
	const nativeOptions = {
		variant,
		description: options.description,
		timeout:
			options.duration === Infinity
				? 0
				: (options.duration ?? (variant === "danger" ? 8000 : 4000)),
		onClose: () => {
			if (options.id !== undefined) ids.delete(options.id);
			options.onDismiss?.();
		},
		actionProps: action
			? {
					children: action.label,
					onPress: action.onClick,
				}
			: variant === "danger" && errorText
				? {
						children: uiText("copy"),
						onPress: () => {
							void navigator.clipboard.writeText(errorText).then(
								() => heroToast.success(uiText("errorCopied")),
								() =>
									heroToast.danger(uiText("couldNotCopyError"), {
										description: errorText,
									}),
							);
						},
					}
				: undefined,
	};
	const previous = options.id === undefined ? undefined : ids.get(options.id);
	const key = previous
		? heroToast.update(previous, title, nativeOptions)
		: heroToast(title, nativeOptions);
	if (options.id !== undefined) ids.set(options.id, key);
	return key;
}
export const toast = Object.assign(notify, {
	success: (message: ReactNode, options?: Options) => notify(message, options, "success"),
	error: (message: ReactNode, options?: Options) => notify(message, options, "danger"),
	info: (message: ReactNode, options?: Options) => notify(message, options, "accent"),
	warning: (message: ReactNode, options?: Options) => notify(message, options, "warning"),
	dismiss: (id?: string | number) => {
		if (id === undefined) {
			heroToast.clear();
			ids.clear();
		} else heroToast.close(ids.get(id) ?? String(id));
	},
});
export function Toaster({ className }: { className?: string }) {
	const text = useUiText();
	return (
		<Toast.Provider placement="bottom end" className={className} aria-label={text("notifications")}>
			{({ toast: notification }) => (
				<Toast toast={notification} variant={notification.content.variant} placement="bottom end">
					<Toast.Indicator variant={notification.content.variant} />
					<Toast.Content>
						<Toast.Title>{notification.content.title}</Toast.Title>
						{notification.content.description && <Toast.Description>{notification.content.description}</Toast.Description>}
					</Toast.Content>
					{notification.content.actionProps && <Toast.ActionButton {...notification.content.actionProps} />}
					<Toast.CloseButton aria-label={text("close")} />
				</Toast>
			)}
		</Toast.Provider>
	);
}
