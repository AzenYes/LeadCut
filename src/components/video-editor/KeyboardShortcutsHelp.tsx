import { Kbd } from "@heroui/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Gear as Settings2, Question as HelpCircle } from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import { FIXED_SHORTCUTS, formatBinding, formatFixedShortcut, SHORTCUT_ACTIONS, SHORTCUT_LABELS } from "@/lib/shortcuts";

export function KeyboardShortcutsHelp() {
	const { shortcuts, isMac, openConfig } = useShortcuts();
	const t = useScopedT("editor");

	return (
		<Popover>
			<PopoverTrigger>
				<Button variant="ghost" size="icon" aria-label={t("keyboardShortcuts.title")}>
					<HelpCircle />
				</Button>
			</PopoverTrigger>

			<PopoverContent align="end" className="w-80" aria-label={t("keyboardShortcuts.title")}>
				<div className="flex items-center justify-between mb-2">
					<span className="text-xs font-semibold text-foreground">
						{t("keyboardShortcuts.title")}
					</span>
					<Button
						variant="ghost"
						type="button"
						onClick={openConfig}
						title={t("keyboardShortcuts.customizeTooltip")}
						className="flex items-center gap-1"
					>
						<Settings2 className="w-3 h-3" />
						{t("keyboardShortcuts.customize")}
					</Button>
				</div>

				<div className="space-y-1.5 text-[10px]">
					{SHORTCUT_ACTIONS.map((action) => (
						<div key={action} className="flex items-center justify-between">
							<span className="text-muted-foreground">{SHORTCUT_LABELS[action]}</span>
							<Kbd>{formatBinding(shortcuts[action], isMac)}</Kbd>
						</div>
					))}

					<div className="mt-1 space-y-1.5 border-t border-separator pt-1.5">
						{FIXED_SHORTCUTS.map(shortcut => (
							<div key={shortcut.action} className="flex items-center justify-between">
								<span className="text-muted-foreground">{shortcut.label}</span>
								<Kbd>{formatFixedShortcut(shortcut, isMac)}</Kbd>
							</div>
						))}
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}
