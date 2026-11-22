import { Tooltip } from "@heroui/react";
import type { ReactNode } from "react";
import { Button, type ButtonProps } from "../ui/button";

export function HudTooltip({ label, children }: { label: string; children: ReactNode }) {
	return (
		<Tooltip delay={350} closeDelay={0}>
			{children}
			<Tooltip.Content placement="top" offset={8} className="pointer-events-none">
				{label}
			</Tooltip.Content>
		</Tooltip>
	);
}

export function HudButton({ tooltip, ...props }: ButtonProps & { tooltip: string }) {
	const button = <Button {...props} aria-label={props["aria-label"] ?? tooltip} />;
	return (
		<HudTooltip label={tooltip}>
			{props.disabled || props.isDisabled ? (
				<Tooltip.Trigger role="presentation" tabIndex={-1} className="inline-flex">
					{button}
				</Tooltip.Trigger>
			) : button}
		</HudTooltip>
	);
}
