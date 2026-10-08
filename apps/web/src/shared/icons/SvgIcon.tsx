import { ICON_SVG, type IconName } from './icon-assets.js';

interface SvgIconProps {
  readonly name: IconName;
  readonly className?: string;
}

export function SvgIcon({ name, className }: SvgIconProps): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={className}
      dangerouslySetInnerHTML={{ __html: ICON_SVG[name] }}
    />
  );
}
