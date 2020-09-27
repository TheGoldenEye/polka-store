// Required imports
import ApiHandler from './ApiHandler';
import { InitAPI, Divide, LoadConfigFile } from './utils';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const db = require('better-sqlite3-helper');

// --------------------------------------------------------------
// --------------------------------------------------------------
async function main() {
  const config = LoadConfigFile();

  // check given chain
  const chain = process.argv[2] || config.defchain;
  const chainData = config.chains[chain];
  if (!chainData) {
    console.log('Syntax: node build/test.js [chain]');
    const chains = Object.keys(config.chains).join(', ');
    console.log('        with chain in [%s]', chains);
    return;
  }

  // open database
  const options = {
    path: config.filename || 'data/' + chain + '.db',
    readonly: true, // read only
    fileMustExist: true, // throw error if database not exists
    WAL: false, // automatically enable 'PRAGMA journal_mode = WAL'?
    migrate: false,
  }
  db(options);

  const api = await InitAPI(chainData.providers, chain);

  // Create API Handler
  const handler = new ApiHandler(api);

  console.log('##########################################');
  console.log('Chain:', chain);
  if (!chainData.check_accounts.length) {
    console.log('  no accounts given');
    return;
  }

  const lastBlock: bigint = db().queryFirstRow('SELECT max(height) AS val FROM transactions').val;
  const date = db().queryFirstRow('SELECT datetime(timestamp/1000, \'unixepoch\', \'localtime\') as val FROM transactions WHERE height=?', lastBlock).val;
  console.log('Balance data at Block: %d (%s)', lastBlock, date);

  // iterate over all test accounts
  for (let i = 0, n = chainData.check_accounts.length; i < n; i++) {
    const accountID = chainData.check_accounts[i];
    const feesReceived: bigint = db().queryFirstRow('SELECT sum(feeBalances) AS val FROM transactions WHERE authorId=?', accountID).val;
    // feesPaid1 calculated from feeBalances and feeTreasury
    const feesPaid1: bigint = db().queryFirstRow('SELECT COALESCE(sum(feeBalances), 0)+COALESCE(sum(feeTreasury), 0) AS val FROM transactions WHERE senderId=?', accountID).val;
    // feesPaid2 calculated from partialFee
    const feesPaid2: bigint = db().queryFirstRow('SELECT COALESCE(sum(partialFee), 0)+COALESCE(sum(tip), 0) AS val FROM transactions WHERE senderId=?', accountID).val;
    const paid: bigint = db().queryFirstRow('SELECT sum(amount) AS val FROM transactions WHERE senderId=?', accountID).val;
    const received: bigint = db().queryFirstRow('SELECT sum(amount) AS val FROM transactions WHERE recipientId=?', accountID).val;
    const total1 = feesReceived + received - feesPaid1 - paid;
    const total2 = feesReceived + received - feesPaid2 - paid;
    const plancks: bigint = chainData.planckPerUnit;

    const hash = await api.rpc.chain.getBlockHash(lastBlock);
    const balance = await handler.fetchBalance(hash, accountID);

    console.log('------------------------------------------',);
    console.log('AccointID:   ', accountID);
    console.log('feesReceived:', feesReceived / plancks);
    console.log('feesPaid1:   ', feesPaid1 / plancks, '(calculated from feeBalances and feeTreasury)');
    console.log('feesPaid2:   ', feesPaid2 / plancks, '(calculated from partialFee)');
    console.log('paid:        ', paid / plancks);
    console.log('received:    ', received / plancks);
    console.log('Balance:     ', total1 / plancks, '(calculated from feeBalances and feeTreasury)');
    console.log('Balance:     ', total2 / plancks, '(calculated from partialFee)');
    console.log('Balance:     ', Divide(BigInt(balance.reserved) + BigInt(balance.free), plancks), '(from API)');
  }

}

main().catch(console.error).finally(() => { process.exit() });
