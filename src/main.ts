// Required imports
import ApiHandler from './ApiHandler';
import CTxDB from './db';
import CLogBlockNr, { InitAPI, ProcessBlockData, LoadConfigFile } from './utils';

// --------------------------------------------------------------
// --------------------------------------------------------------
async function main() {

  process.on('SIGINT', () => {  // Ctrl+C pressed
    console.log('');
    process.exit();
  });

  const config = LoadConfigFile();

  const chain = process.argv[2] || config.defchain;
  const chainData = config.chains[chain];
  if (!chainData) {
    console.log('Syntax: node build/main.js [chain]');
    const chains = Object.keys(config.chains).join(', ');
    console.log('        with chain in [%s]', chains);
    return;
  }

  const api = await InitAPI(chainData.providers, chain);

  // Create API Handler
  const handler = new ApiHandler(api);

  // Create transaction database instance
  const db = new CTxDB(chain, config.filename || 'data/' + chain + '.db');

  const maxBlock = db.GetMaxHeight();
  const header = await api.rpc.chain.getHeader();
  const LogBlock = new CLogBlockNr(api, Number(header.number))

  console.log('Press "Ctrl+C" to cancel ...\n');

  // scan the chain and write block data to database
  const start = Math.max(maxBlock, chainData.startBlock)
  for (let i = start; i <= LogBlock.LastBlock(); i++) {
    await ProcessBlockData(api, handler, db, i, chain);
    LogBlock.LogBlock(i, i == LogBlock.LastBlock());
  }
}

main().catch(console.error).finally(() => { process.exit() });
