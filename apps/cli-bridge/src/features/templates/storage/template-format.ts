import { PromptTemplateSchema, type PromptTemplate } from '@codex-complex-prompt/protocol';
import { TemplateFrontmatterValueSchema } from './schema.js';

export const templateDefinitions = [
  {
    id: '00000000-0000-4000-8000-000000000101',
    name: 'PRD / Feature Requirements',
    description: 'Define the user problem, product goals, requirements, and acceptance criteria.',
    body: 'Implement the product requirements below. Ask questions first when information is missing, and distinguish facts from assumptions.\n\n## User problem\n## Goals and non-goals\n## Target users and user flows\n## Functional requirements\n## Acceptance criteria\n## Open questions\n',
  },
  {
    id: '00000000-0000-4000-8000-000000000102',
    name: 'RFC / Technical Proposal',
    description:
      'Document the context, proposal, alternatives, trade-offs, operational impact, and rollout plan.',
    body: 'Write a reviewable technical proposal based on the information below. Mark uncertain details and compare alternatives fairly.\n\n## Context and problem\n## Proposal\n## Alternatives considered\n## Trade-offs and risks\n## Operational and security impact\n## Phased rollout and rollback\n## Open questions\n',
  },
  {
    id: '00000000-0000-4000-8000-000000000103',
    name: 'Write an ADR',
    description:
      'Record the context, alternatives, decision, and consequences of a technical choice.',
    body: 'Write a concise Architecture Decision Record using the information below. Do not present a decision as final unless it has been approved.\n\n## Title\n## Status\n## Context and decision drivers\n## Alternatives considered\n## Decision\n## Consequences and follow-up\n',
  },
  {
    id: '00000000-0000-4000-8000-000000000104',
    name: 'CO-STAR Task Brief',
    description: 'Shape a task around its context, objective, style, tone, audience, and response.',
    body: 'Use the CO-STAR structure for the task below. Do not invent missing details; ask questions instead.\n\n## Context\n## Objective\n## Style\n## Tone\n## Audience\n## Response\n',
  },
  {
    id: '00000000-0000-4000-8000-000000000105',
    name: 'RISEN Task Instructions',
    description:
      'Structure a complex task around its role, instructions, steps, end goal, and constraints.',
    body: 'Use the RISEN structure for the task below. Specify the order of work and completion criteria.\n\n## Role\n## Instructions\n## Steps\n## End goal\n## Narrowing constraints\n',
  },
  {
    id: '00000000-0000-4000-8000-000000000106',
    name: 'Meeting Follow-up Actions',
    description:
      'Summarize meeting decisions, open questions, additional information needed, and follow-up tasks.',
    body: 'Create follow-up actions from the meeting notes below. Distinguish decisions from proposals. Do not invent owners or due dates.\n\n## Decisions\n## Open questions\n## Additional questions and materials needed\n## Follow-up tasks (task, owner, due date)\n',
  },
] as const;

export function serializeTemplate(template: PromptTemplate): string {
  return `---\nname: ${JSON.stringify(template.name)}\ndescription: ${JSON.stringify(template.description)}\n---\n${template.body}`;
}

export function parseTemplate(content: string, id: string): PromptTemplate {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (match === null) throw new Error('Template frontmatter is missing.');
  const fields = new Map<string, string>();
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const field = line.match(/^(name|description):\s*(.+)$/);
    if (field === null) throw new Error('Template frontmatter is malformed.');
    const value: unknown = JSON.parse(field[2] ?? '');
    const parsedValue = TemplateFrontmatterValueSchema.safeParse(value);
    if (!parsedValue.success) throw new Error('Template frontmatter is malformed.');
    fields.set(field[1] ?? '', parsedValue.data);
  }
  const name = fields.get('name');
  const description = fields.get('description');
  if (name === undefined || description === undefined)
    throw new Error('Template metadata is missing.');
  const parsed = PromptTemplateSchema.safeParse({ id, name, description, body: match[2] ?? '' });
  if (!parsed.success) throw new Error('Template does not match the prompt template schema.');
  return parsed.data;
}
