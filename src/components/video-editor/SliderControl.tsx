import { Label, Slider } from "@heroui/react";
import { memo, type ReactNode } from "react";
interface SliderControlProps {
	label: string;
	ariaLabel?: string;
	value: number;
	min: number;
	max: number;
	step: number;
	onChange: (value: number) => void;
	onCommit?: (value: number) => void;
	formatValue: (value: number) => string;
	valueInput?: ReactNode;
}
export const SliderControl = memo(function SliderControl({
	label,
	ariaLabel,
	value,
	min,
	max,
	step,
	onChange,
	onCommit,
	formatValue,
	valueInput,
}: SliderControlProps) {
	return (
		<Slider
			aria-label={ariaLabel ?? label}
			value={value}
			minValue={min}
			maxValue={max}
			step={step}
			onChange={(value) => onChange(Number(value))}
			onChangeEnd={onCommit && ((value) => onCommit(Number(value)))}
			className="my-1 w-full gap-y-2"
		>
			<Label className="text-xs">{label}</Label>
			{valueInput ?? <Slider.Output className="text-xs font-normal">
				{() => formatValue(value)}
			</Slider.Output>}
			<Slider.Track>
				<Slider.Fill />
				<Slider.Thumb />
			</Slider.Track>
		</Slider>
	);
});
