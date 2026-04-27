import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerPing(server: McpServer): void {
  server.registerTool(
    'ping',
    {
      title: 'ping',
      description: 'Health check. Returns "pong".',
      inputSchema: {},
    },
    async () => ({
      content: [{ type: 'text', text: 'pong' }],
    }),
  );
}
