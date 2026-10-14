import { useCallback, useState } from 'react';

import type {
  ClientMessage,
  FeedbackSubagentSettings,
  PromptSubmitMode,
  ServerMessage,
} from '@codex-complex-prompt/protocol';

import { getInitialConnection } from './bridge-url.js';
import type {
  BridgeSession,
  ConnectionState,
  PromptResult,
  TemplateChangeRequest,
  TemplateResult,
} from './bridge-session-types.js';
import { useAttachment } from './useAttachment.js';
import { useBridgeConnection } from './useBridgeConnection.js';
import { useDelayedClose } from './useDelayedClose.js';
import { usePending } from './usePending.js';

export function useBridgeSessionController(): BridgeSession {
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    () => getInitialConnection().state,
  );
  const [error, setError] = useState<string | null>(() => getInitialConnection().error);
  const [initialMarkdown, setInitialMarkdown] = useState<string | null>(null);
  const [feedbackLoop, setFeedbackLoop] = useState(false);
  const [feedbackModelCatalog, setFeedbackModelCatalog] = useState<
    BridgeSession['feedbackModelCatalog']
  >([]);
  const [feedbackModelCatalogLoading, setFeedbackModelCatalogLoading] = useState(false);
  const [templateSnapshot, setTemplateSnapshot] = useState<BridgeSession['templateSnapshot']>(null);

  const { attachmentUrl, attachmentToken, setAttachment } = useAttachment();
  const { isCloseScheduled, cancelClose, clearCloseTimer, scheduleClose } = useDelayedClose();
  const pendingPrompts = usePending<PromptResult>();
  const pendingTemplates = usePending<TemplateResult>();
  const failPendingResults = useCallback(
    (message: string): void => {
      const failure = { status: 'failed' as const, error: message };
      pendingPrompts.failAll(failure);
      pendingTemplates.failAll(failure);
    },
    [pendingPrompts, pendingTemplates],
  );

  const handleMessage = useCallback(
    (message: ServerMessage, send: (message: ClientMessage) => void): void => {
      switch (message.type) {
        case 'session.ready': {
          setConnectionState('connected');
          setError(null);
          setInitialMarkdown(message.initialMarkdown ?? '');
          setFeedbackLoop(message.feedbackLoop ?? false);
          setFeedbackModelCatalog(message.feedbackModelCatalog ?? []);
          const shouldLoadFeedbackModelCatalog = message.feedbackModelCatalog === undefined;
          setFeedbackModelCatalogLoading(shouldLoadFeedbackModelCatalog);
          if (shouldLoadFeedbackModelCatalog) {
            try {
              send({ type: 'feedback-model.catalog.request' });
            } catch {
              setFeedbackModelCatalogLoading(false);
            }
          }
          setAttachment(message.attachmentUrl ?? null, message.attachmentToken ?? null);
          setTemplateSnapshot({
            templates: message.templates ?? [],
            error: message.templatesError ?? null,
          });
          break;
        }
        case 'feedback-model.catalog.result':
          setFeedbackModelCatalog(message.catalog);
          setFeedbackModelCatalogLoading(false);
          break;
        case 'template.result': {
          const result: TemplateResult = {
            status: message.status,
            ...(message.templates === undefined ? {} : { templates: message.templates }),
            ...(message.error === undefined ? {} : { error: message.error }),
          };
          pendingTemplates.resolve(message.requestId, result);
          break;
        }
        case 'prompt.result': {
          const result: PromptResult = {
            status: message.status,
            ...(message.error === undefined ? {} : { error: message.error }),
            ...(message.prompt === undefined ? {} : { prompt: message.prompt }),
          };
          pendingPrompts.resolve(message.submissionId, result);
          if (message.status === 'accepted') {
            setConnectionState('success');
            setError(null);
            scheduleClose();
          } else {
            cancelClose();
            setConnectionState('error');
            setError(message.error ?? 'The command could not be sent.');
          }
          break;
        }
        case 'session.error':
          failPendingResults(message.message);
          setConnectionState('error');
          setError(message.message);
          break;
      }
    },
    [
      cancelClose,
      failPendingResults,
      pendingPrompts,
      pendingTemplates,
      scheduleClose,
      setAttachment,
    ],
  );

  const handleInvalidMessage = useCallback((): void => {
    failPendingResults('The bridge returned an invalid message.');
    setConnectionState('error');
    setError('The bridge returned an invalid message.');
  }, [failPendingResults]);

  const handleClose = useCallback((): void => {
    failPendingResults('The bridge connection closed.');
    setConnectionState((current) =>
      current === 'success' || current === 'error' ? current : 'disconnected',
    );
  }, [failPendingResults]);

  const handleError = useCallback((): void => {
    failPendingResults('Could not connect to the local bridge.');
    setConnectionState('error');
    setError('Could not connect to the local bridge.');
  }, [failPendingResults]);

  const handleCleanup = useCallback((): void => {
    failPendingResults('The bridge connection closed.');
    clearCloseTimer();
  }, [clearCloseTimer, failPendingResults]);

  const connection = useBridgeConnection({
    onMessage: handleMessage,
    onInvalidMessage: handleInvalidMessage,
    onClose: handleClose,
    onError: handleError,
    onCleanup: handleCleanup,
  });

  const submit = useCallback(
    (
      prompt: string,
      mode: PromptSubmitMode = 'edit',
      options: FeedbackSubagentSettings = {},
    ): Promise<PromptResult> => {
      /* c8 ignore next -- the button disables this path when no authenticated socket exists. */
      if (!connection.isOpen() || (prompt.trim() === '' && mode !== 'finish')) {
        return Promise.resolve({ status: 'failed', error: 'The bridge is not connected.' });
      }
      setConnectionState('submitting');
      setError(null);
      const submissionId = crypto.randomUUID();
      const result = pendingPrompts.waitFor(submissionId);
      try {
        connection.send({
          type: 'prompt.submit',
          submissionId,
          prompt: prompt.trim(),
          ...(mode === 'edit' ? {} : { mode }),
          ...(mode === 'feedback' && options.sendFeedbackToSubagent === true
            ? { sendFeedbackToSubagent: true }
            : {}),
          ...(mode === 'feedback' &&
          options.sendFeedbackToSubagent === true &&
          options.feedbackModel !== undefined
            ? { feedbackModel: options.feedbackModel }
            : {}),
        });
      } catch {
        pendingPrompts.delete(submissionId);
        setConnectionState('error');
        setError('The bridge connection closed.');
        return Promise.resolve({ status: 'failed', error: 'The bridge connection closed.' });
      }
      return result;
    },
    [connection, pendingPrompts],
  );

  const requestTemplateChange = useCallback(
    (request: TemplateChangeRequest): Promise<TemplateResult> => {
      if (!connection.isOpen()) {
        return Promise.resolve({ status: 'failed', error: 'The bridge is not connected.' });
      }
      const requestId = crypto.randomUUID();
      const result = pendingTemplates.waitFor(requestId);
      try {
        connection.send({ ...request, requestId });
      } catch {
        pendingTemplates.delete(requestId);
        return Promise.resolve({ status: 'failed', error: 'The bridge connection closed.' });
      }
      return result;
    },
    [connection, pendingTemplates],
  );

  return {
    connectionState,
    error,
    isCloseScheduled,
    bridgeUrl: connection.bridgeUrl,
    initialMarkdown,
    feedbackLoop,
    feedbackModelCatalog,
    feedbackModelCatalogLoading,
    attachmentUrl,
    attachmentToken,
    templateSnapshot,
    requestTemplateChange,
    submit,
  };
}
