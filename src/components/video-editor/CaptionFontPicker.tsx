import { useId, useState } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useScopedT } from "@/contexts/I18nContext";
import { fontFamilyDisplayName, listLocalFontFamilies, localFontCssFamily } from "@/lib/localFonts";

export function CaptionFontPicker({
	value,
	onChange,
	label,
}: {
	value: string;
	onChange: (value: string) => void;
	label?: string;
}) {
	const t = useScopedT("settings");
	const listId = useId();
	const [open, setOpen] = useState(false);
	const [fonts, setFonts] = useState<string[]>([]);
	const [search, setSearch] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState(false);
	const family = fontFamilyDisplayName(value);
	const fontLabel = label ?? t("captions.fontFamily", "Font");
	const filtered = fonts.filter((font) =>
		font.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
	);
	const choose = (font: string) => {
		if (!font.trim()) return;
		onChange(localFontCssFamily(font.trim()));
		setOpen(false);
	};
	const loadFonts = async () => {
		setLoading(true);
		setError(false);
		try {
			setFonts(await listLocalFontFamilies());
		} catch {
			setError(true);
		} finally {
			setLoading(false);
		}
	};
	return (
		<div className="flex flex-col gap-2">
			<span className="text-sm">{fontLabel}</span>
			<Popover
				open={open}
				onOpenChange={(next) => {
					setOpen(next);
					if (next) {
						setSearch("");
						if (!fonts.length) void loadFonts();
					}
				}}
			>
				<PopoverTrigger asChild>
					<Button
						type="button"
						variant="outline"
						aria-label={fontLabel}
						aria-expanded={open}
						aria-controls={open ? listId : undefined}
						className="h-10 w-full min-w-0 justify-between gap-2 px-3 text-sm font-normal"
					>
						<span className="min-w-0 truncate">{family}</span>
						<CaretDown
							className="size-4 shrink-0 text-muted-foreground"
							aria-hidden="true"
						/>
					</Button>
				</PopoverTrigger>
				<PopoverContent
					aria-label={t("captions.localFonts", "Choose local font")}
					align="start"
					sideOffset={4}
					className="w-80 space-y-2 p-2"
				>
					<Input
						aria-label={t("captions.searchFonts", "Search fonts")}
						placeholder={t("captions.searchFonts", "Search fonts")}
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !loading) {
								event.preventDefault();
								choose(filtered[0] ?? search);
							}
							if (event.key === "ArrowDown") {
								event.preventDefault();
								document
									.getElementById(listId)
									?.querySelector<HTMLButtonElement>("[role=option]")
									?.focus();
							}
						}}
					/>
					{loading ? (
						<p role="status" className="p-2 text-sm">
							{t("captions.loadingFonts", "Loading fonts…")}
						</p>
					) : error ? (
						<div className="space-y-2 p-2">
							<p role="alert" className="text-sm">
								{t(
									"captions.fontLoadFailed",
									"Could not read local fonts. Retry or enter an installed font name.",
								)}
							</p>
							<Button type="button" size="sm" onClick={() => void loadFonts()}>
								{t("captions.retryFonts", "Retry")}
							</Button>
						</div>
					) : (
						<div
							id={listId}
							role="listbox"
							aria-label={t("captions.fontList", "Installed fonts")}
							className="max-h-64 overflow-y-auto overscroll-contain"
							onKeyDown={(event) => {
								const options = Array.from(
									event.currentTarget.querySelectorAll<HTMLButtonElement>(
										"[role=option]",
									),
								);
								const index = options.indexOf(event.target as HTMLButtonElement);
								const next =
									event.key === "ArrowDown"
										? Math.min(index + 1, options.length - 1)
										: event.key === "ArrowUp"
											? Math.max(index - 1, 0)
											: event.key === "Home"
												? 0
												: event.key === "End"
													? options.length - 1
													: null;
								if (next !== null) {
									event.preventDefault();
									options[next]?.focus();
								}
							}}
						>
							{filtered.map((font) => (
								<button
									key={font}
									role="option"
									aria-selected={font === family}
									type="button"
									className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm font-normal hover:bg-default focus-visible:bg-default focus-visible:outline-none aria-selected:bg-default"
									style={{ fontFamily: localFontCssFamily(font) }}
									onClick={() => choose(font)}
								>
									<span className="truncate">{font}</span>
									{font === family && (
										<Check className="size-4 shrink-0" aria-hidden="true" />
									)}
								</button>
							))}
							{!filtered.length && (
								<p className="p-2 text-sm text-muted-foreground">
									{t("captions.noFonts", "No fonts found.")}
								</p>
							)}
						</div>
					)}
					{search.trim() &&
						!loading &&
						!fonts.some(
							(font) =>
								font.toLocaleLowerCase() === search.trim().toLocaleLowerCase(),
						) && (
							<Button
								type="button"
								variant="secondary"
								className="w-full justify-start truncate"
								onClick={() => choose(search)}
							>
								{t("captions.useFontName", "Use font name: {{name}}", {
									name: search.trim(),
								})}
							</Button>
						)}
				</PopoverContent>
			</Popover>
		</div>
	);
}
