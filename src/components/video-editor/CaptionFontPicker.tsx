import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useScopedT } from "@/contexts/I18nContext";
import {
	fontFamilyDisplayName,
	getCachedLocalFontFamilies,
	listLocalFontFamilies,
	localFontCssFamily,
} from "@/lib/localFonts";

const ROW_HEIGHT = 36;
const LIST_HEIGHT = 256;
const OVERSCAN_ROWS = 3;

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
	const [scrollTop, setScrollTop] = useState(0);
	const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const pendingFocus = useRef<number | null>(null);
	const family = fontFamilyDisplayName(value);
	const fontLabel = label ?? t("captions.fontFamily", "Font");
	const query = search.trim().toLocaleLowerCase();
	const names = useMemo(
		() => fonts.map((name) => ({ name, searchKey: name.toLocaleLowerCase() })),
		[fonts],
	);
	const filtered = useMemo(
		() => (query ? names.filter((font) => font.searchKey.includes(query)) : names),
		[names, query],
	);
	const visibleStart = Math.min(
		Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS),
		filtered.length,
	);
	const visibleEnd = Math.min(
		filtered.length,
		Math.ceil((scrollTop + LIST_HEIGHT) / ROW_HEIGHT) + OVERSCAN_ROWS,
	);
	const visibleIndices = Array.from(
		{ length: visibleEnd - visibleStart },
		(_, index) => visibleStart + index,
	);
	if (
		focusedIndex !== null &&
		focusedIndex < filtered.length &&
		!visibleIndices.includes(focusedIndex)
	) {
		visibleIndices.push(focusedIndex);
		visibleIndices.sort((a, b) => a - b);
	}
	const focusElement = (index: number) => {
		const element = listRef.current?.ownerDocument.getElementById(`${listId}-${index}`);
		if (!element) return false;
		element.focus({ preventScroll: true });
		return true;
	};
	useLayoutEffect(() => {
		const index = pendingFocus.current;
		if (index !== null && focusElement(index)) pendingFocus.current = null;
	});
	const focusOption = (index: number) => {
		const list = listRef.current;
		if (!list || !filtered.length) return;
		const next = Math.max(0, Math.min(filtered.length - 1, index));
		const top = next * ROW_HEIGHT;
		if (top < list.scrollTop) list.scrollTop = top;
		else if (top + ROW_HEIGHT > list.scrollTop + list.clientHeight) {
			list.scrollTop = top + ROW_HEIGHT - list.clientHeight;
		}
		setScrollTop(list.scrollTop);
		if (!focusElement(next)) {
			pendingFocus.current = next;
			setFocusedIndex(next);
		}
	};
	const changeSearch = (text: string) => {
		setSearch(text);
		setScrollTop(0);
		setFocusedIndex(null);
		pendingFocus.current = null;
		if (listRef.current) listRef.current.scrollTop = 0;
	};
	const choose = (font: string) => {
		if (!font.trim()) return;
		const next = localFontCssFamily(font.trim());
		if (next !== value) onChange(next);
		setOpen(false);
	};
	const loadFonts = async (refresh = false) => {
		const cached = !refresh && getCachedLocalFontFamilies();
		if (cached) setFonts(cached);
		else setLoading(true);
		setError(false);
		try {
			setFonts(await listLocalFontFamilies(refresh));
		} catch {
			if (!cached) setError(true);
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
						changeSearch("");
						void loadFonts();
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
						onChange={(event) => changeSearch(event.target.value)}
						onKeyDown={(event) => {
							if (event.nativeEvent.isComposing) return;
							if (event.key === "Enter" && !loading) {
								event.preventDefault();
								choose(filtered[0]?.name ?? search);
							}
							if (event.key === "ArrowDown") {
								event.preventDefault();
								focusOption(0);
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
							<Button type="button" size="sm" onClick={() => void loadFonts(true)}>
								{t("captions.retryFonts", "Retry")}
							</Button>
						</div>
					) : (
						<div
							ref={listRef}
							id={listId}
							role="listbox"
							aria-label={t("captions.fontList", "Installed fonts")}
							className="max-h-64 overflow-y-auto overscroll-contain"
							style={{ maxHeight: LIST_HEIGHT }}
							onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
						>
							{filtered.length > 0 && (
								<div
									role="presentation"
									className="relative"
									style={{ height: filtered.length * ROW_HEIGHT }}
								>
									{visibleIndices.map((index) => {
										const { name: font } = filtered[index];
										return (
											<button
												key={font}
												id={`${listId}-${index}`}
												role="option"
												aria-selected={font === family}
												aria-posinset={index + 1}
												aria-setsize={filtered.length}
												type="button"
												tabIndex={index === (focusedIndex ?? 0) ? 0 : -1}
												className="absolute inset-x-0 flex w-full items-center justify-between gap-2 rounded-lg px-2 text-left text-sm font-normal hover:bg-default focus-visible:bg-default focus-visible:outline-none aria-selected:bg-default"
												style={{
													fontFamily: localFontCssFamily(font),
													top: index * ROW_HEIGHT,
													height: ROW_HEIGHT,
												}}
												onFocus={() => setFocusedIndex(index)}
												onKeyDown={(event) => {
													const targets: Record<string, number> = {
														ArrowDown: index + 1,
														ArrowUp: index - 1,
														Home: 0,
														End: filtered.length - 1,
													};
													const target = targets[event.key];
													if (typeof target !== "number") return;
													event.preventDefault();
													focusOption(target);
												}}
												onClick={() => choose(font)}
											>
												<span className="truncate">{font}</span>
												{font === family && (
													<Check
														className="size-4 shrink-0"
														aria-hidden="true"
													/>
												)}
											</button>
										);
									})}
								</div>
							)}
							{!filtered.length && (
								<p className="p-2 text-sm text-muted-foreground">
									{t("captions.noFonts", "No fonts found.")}
								</p>
							)}
						</div>
					)}
					{query && !loading && !filtered.some((font) => font.searchKey === query) && (
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
