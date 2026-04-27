import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { sql } from './db/client.js';
import { registerPing } from './tools/ping.js';
import { registerComputeTypeMatchup } from './tools/compute-type-matchup.js';
import { registerGetPokemon } from './tools/get-pokemon.js';
import { registerFindPokemon } from './tools/find-pokemon.js';
import { registerDamageCalc } from './tools/damage-calc.js';
import { registerGetPokemonMoves } from './tools/get-pokemon-moves.js';
import { registerFindMoves } from './tools/find-moves.js';

const server = new McpServer({
  name: 'pokemon-match',
  version: '0.1.0',
});

registerPing(server);
registerComputeTypeMatchup(server);
registerGetPokemon(server);
registerFindPokemon(server);
registerDamageCalc(server);
registerGetPokemonMoves(server);
registerFindMoves(server);

const transport = new StdioServerTransport();
transport.onclose = async () => {
  await sql.end();
};
await server.connect(transport);
