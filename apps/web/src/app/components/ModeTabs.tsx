import { Tabs } from '@base-ui/react/tabs';

interface ModeTabsProps {
  readonly mode: 'edit' | 'feedback';
  readonly onChange: (mode: 'edit' | 'feedback') => void;
}

export function ModeTabs({ mode, onChange }: ModeTabsProps): React.JSX.Element {
  return (
    <Tabs.Root
      className="mode-tabs"
      value={mode}
      onValueChange={(value) => onChange(value === 'feedback' ? 'feedback' : 'edit')}
    >
      <Tabs.List aria-label="Prompt mode">
        <Tabs.Tab value="edit" className="mode-tab">
          Edit Mode
        </Tabs.Tab>
        <Tabs.Tab value="feedback" className="mode-tab">
          AI Feedback Mode
        </Tabs.Tab>
        <Tabs.Indicator className="mode-tab-indicator" />
      </Tabs.List>
    </Tabs.Root>
  );
}
