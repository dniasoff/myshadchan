interface RoundButtonProps {
  color: string;
  handleClick: () => void;
  selected: boolean;
}

export const RoundButton = ({
  color,
  handleClick,
  selected,
}: RoundButtonProps) => (
  <button
    type="button"
    aria-label={`Select color ${color}`}
    aria-pressed={selected}
    className={`w-8 h-8 rounded-full inline-block m-1 transition-all ${
      selected ? "ring-2 ring-ring ring-offset-1" : ""
    }`}
    style={{ backgroundColor: color }}
    onClick={handleClick}
  />
);
