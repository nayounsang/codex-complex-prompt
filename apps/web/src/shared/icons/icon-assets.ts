import close from './assets/close.svg?raw';
import diagram from './assets/diagram.svg?raw';
import media from './assets/media.svg?raw';
import pencil from './assets/pencil.svg?raw';
import templateDelete from './assets/template-delete.svg?raw';
import templateEdit from './assets/template-edit.svg?raw';
import trash from './assets/trash.svg?raw';

export const ICON_SVG = {
  close,
  diagram,
  media,
  pencil,
  templateDelete,
  templateEdit,
  trash,
} as const;

export type IconName = keyof typeof ICON_SVG;
