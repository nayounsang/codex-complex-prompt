import { useCallback, useState } from 'react';

import type { PromptTemplate } from '@codex-complex-prompt/protocol';

import type {
  TemplateChangeRequest,
  TemplateResult,
} from '../../session/hooks/useBridgeSession.js';

interface TemplateSnapshot {
  readonly templates: readonly PromptTemplate[];
  readonly error: string | null;
}

interface ProjectTemplateBridge {
  readonly snapshot: TemplateSnapshot | null;
  readonly requestChange: (request: TemplateChangeRequest) => Promise<TemplateResult>;
}

interface ProjectTemplateState extends TemplateSnapshot {
  readonly snapshot: TemplateSnapshot | null;
}

export function useProjectTemplates(bridge: ProjectTemplateBridge): {
  readonly templates: readonly PromptTemplate[];
  readonly error: string | null;
  readonly save: (template: PromptTemplate) => Promise<TemplateResult>;
  readonly remove: (id: string) => Promise<TemplateResult>;
} {
  const { snapshot, requestChange } = bridge;
  const [state, setState] = useState<ProjectTemplateState>(() => ({
    snapshot,
    templates: snapshot?.templates ?? [],
    error: snapshot?.error ?? null,
  }));
  const currentState =
    state.snapshot === snapshot
      ? state
      : {
          snapshot,
          templates: snapshot?.templates ?? [],
          error: snapshot?.error ?? null,
        };

  const save = useCallback(
    async (template: PromptTemplate): Promise<TemplateResult> => {
      const result = await requestChange({ type: 'template.save', template });
      if (result.status === 'accepted' && result.templates !== undefined) {
        setState({ snapshot, templates: result.templates, error: null });
      }
      return result;
    },
    [requestChange, snapshot],
  );

  const remove = useCallback(
    async (id: string): Promise<TemplateResult> => {
      const result = await requestChange({ type: 'template.delete', id });
      if (result.status === 'accepted' && result.templates !== undefined) {
        setState({ snapshot, templates: result.templates, error: null });
      }
      return result;
    },
    [requestChange, snapshot],
  );

  return { templates: currentState.templates, error: currentState.error, save, remove };
}
