import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const ATTRIBUTION = [
  'pong',
  '',
  'pokemon-match-mcp',
  'Champions overrides: otterlyclueless/pokemon-champions-data (CC BY 4.0)',
  'Battle data: @smogon/calc, @pkmn/dex, @pkmn/sim',
  'Usage stats: smogon.com/stats',
  'JP names: PokéAPI (pokeapi.co)',
].join('\n');

export function registerPing(server: McpServer): void {
  server.registerTool(
    'ping',
    {
      title: 'ping',
      description: 'ヘルスチェック。"pong" + データソース帰属表記を返す。',
      inputSchema: {},
    },
    async () => ({
      content: [{ type: 'text', text: ATTRIBUTION }],
    }),
  );
}
