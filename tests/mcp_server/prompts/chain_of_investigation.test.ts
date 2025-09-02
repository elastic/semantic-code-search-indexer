import { createStartChainOfInvestigationHandler } from '../../../src/mcp_server/prompts/chain_of_investigation';

describe('startChainOfInvestigation', () => {
  it('should return a a chain of investigation workflow', async () => {
    const workflow = 'Test workflow';
    const handler = createStartChainOfInvestigationHandler(workflow);
    const result = await handler({
      task: 'My test task',
    });
    const content = result.messages[0].content;
    if (typeof content === 'string' || !('text' in content)) {
      throw new Error('Expected content to be a ContentPart object with a text property');
    }
    expect(content.text).toContain('Here is a chain of investigation workflow to help you with your task: "My test task"');
    expect(content.text).toContain('## Workflow\n\nTest workflow');
  });
});
