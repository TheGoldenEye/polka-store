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
  db().defaultSafeIntegers(true);

  process.on('exit', () => db().close());     // close database on exit

  const api = await InitAPI(chainData.providers, chain);

  // Create API Handler
  const handler = new ApiHandler(api);

  console.log('##########################################');
  console.log('Chain:', chain);
  if (!chainData.check_accounts.length) {
    console.log('  no accounts given');
    return;
  }

  const lastBlock = Number(db().queryFirstRow('SELECT max(height) AS val FROM transactions').val);
  const date = db().queryFirstRow('SELECT datetime(timestamp/1000, \'unixepoch\', \'localtime\') as val FROM transactions WHERE height=?', lastBlock).val;
  console.log('Balance data at Block: %d (%s)', lastBlock, date);

  // iterate over all test accounts
  for (let i = 0, n = chainData.check_accounts.length; i < n; i++) {
    const name = chainData.check_accounts[i].name;
    const accountID = chainData.check_accounts[i].account;
    const plancks = BigInt(chainData.planckPerUnit);

    // balance calculation
    const feesReceived: bigint = db().queryFirstRow('SELECT sum(feeBalances) AS val FROM transactions WHERE authorId=?', accountID).val || BigInt(0);
    // feesPaid calculated from feeBalances and feeTreasury:
    const feesPaid: bigint = db().queryFirstRow('SELECT COALESCE(sum(feeBalances), 0)+COALESCE(sum(feeTreasury), 0) AS val FROM transactions WHERE senderId=?', accountID).val || BigInt(0);
    // feesPaid calculated from partialFee:
    // const feesPaid : bigint = db().queryFirstRow('SELECT COALESCE(sum(partialFee), 0)+COALESCE(sum(tip), 0) AS val FROM transactions WHERE senderId=?', accountID).val || BigInt(0);
    const paid: bigint = db().queryFirstRow('SELECT sum(amount) AS val FROM transactions WHERE senderId=?', accountID).val || BigInt(0);
    const received: bigint = db().queryFirstRow('SELECT sum(amount) AS val FROM transactions WHERE recipientId=?', accountID).val || BigInt(0);
    const total: bigint = feesReceived + received - feesPaid - paid;
    const totalD = Divide(total, plancks);

    // balance from API
    const hash = await api.rpc.chain.getBlockHash(lastBlock);
    const balance = await handler.fetchBalance(hash, accountID);
    const balanceTotal = BigInt(balance.reserved) + BigInt(balance.free);
    const balanceTotalD = Divide(balanceTotal, plancks);

    console.log('------------------------------------------',);
    console.log('Account:     %s (%s)', name, accountID);
    //console.log('feesReceived:%d %s', feesReceived / plancks, chainData.unit);
    //console.log('feesPaid:    %d %s', feesPaid / plancks, chainData.unit);
    //console.log('paid:        %d %s', paid / plancks, chainData.unit);
    //console.log('received:    %d %s', received / plancks, chainData.unit);
    console.log('Balance:     %d %s (calculated)', totalD, chainData.unit);
    console.log('Balance:     %d %s (from API)', balanceTotalD, chainData.unit);
    console.log('Difference:  %d %s', Divide(balanceTotal - total, plancks), chainData.unit);
  }
}

main().catch(console.error).finally(() => { process.exit() });
