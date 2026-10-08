import { describe, expect, it } from 'vitest';

import { parseAttachmentResponse } from './attachment-response.js';

describe('parseAttachmentResponse', () => {
  it('returns a validated attachment response', () => {
    expect(
      parseAttachmentResponse('{"id":"attachment-id","extension":"png"}', 201, 'failed'),
    ).toEqual({ id: 'attachment-id', extension: 'png' });
  });

  it('preserves a server error response', () => {
    expect(parseAttachmentResponse('{"error":"Rejected"}', 400, 'failed')).toEqual({
      error: 'Rejected',
    });
  });

  it('reports malformed JSON using the server body when present', () => {
    expect(() => parseAttachmentResponse('not json', 500, 'failed')).toThrow('not json');
  });

  it('rejects a valid JSON value that does not match the response contract', () => {
    expect(() => parseAttachmentResponse('null', 200, 'failed')).toThrow(
      'The attachment server returned an invalid response (HTTP 200).',
    );
  });
});
