import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const [name, option, file] = process.argv.slice(2);
if (!name || (option && (option !== '--args-file' || !file))) {
  throw new Error('Usage: node scripts/call-tool.mjs <tool-name|--list> [--args-file request.json]');
}
const args = file ? JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '')) : {};
const client = new Client({name:'leadcut-local-client', version:'1.0.0'});
try {
  await client.connect(new StdioClientTransport({command:process.execPath, args:[fileURLToPath(new URL('../dist/index.js', import.meta.url))]}));
  if(name === '--list') console.log(JSON.stringify(await client.listTools(), null, 2));
  else {
    const result = await client.callTool({name, arguments:args}, undefined, {timeout:3600000});
    const content = result.content.map(c=>c.type === 'text' ? c.text : {type:c.type, mimeType:c.mimeType});
    for(const item of content) console.log(typeof item === 'string' ? item : JSON.stringify(item));
    if(result.isError) process.exitCode = 1;
  }
} finally { await client.close(); }
