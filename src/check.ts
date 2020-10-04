// Required imports
import { Divide, LoadConfigFile } from './utils';
import { CPolkaStore } from "./CPolkaStore";
import * as chalk from 'chalk';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const db = require('better-sqlite3-helper');

// --------------------------------------------------------------
// --------------------------------------------------------------
async function main() {
  // command line parameters:
  // process.argv[2]: chain (optional)
  // process.argv[3]: atBlock (optional)

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
    readonly: false,
    fileMustExist: true, // throw error if database not exists
    WAL: false, // automatically enable 'PRAGMA journal_mode = WAL'?
    migrate: false,
  }
  db(options);
  db().defaultSafeIntegers(true);

  process.on('exit', () => db().close());     // close database on exit

  const polkaStore = new CPolkaStore(chainData, chain);
  await polkaStore.InitAPI();

  console.log('##########################################');
  console.log('Chain:', chain);
  if (!chainData.check_accounts.length) {
    console.log('  no accounts given');
    return;
  }

  const lastBlock = Number(db().queryFirstRow('SELECT max(height) AS val FROM transactions').val);
  const sBlock = process.argv[3];   // the block nuber was given by command line?
  const atBlock = isNaN(+sBlock) ? lastBlock : Math.min(+sBlock, lastBlock);  // not behind lastBlock
  const date = db().queryFirstRow('SELECT datetime(timestamp/1000, \'unixepoch\', \'localtime\') as val FROM transactions WHERE height=?', atBlock)?.val;
  console.log('Balance data at Block: %d (%s)', atBlock, date ? date : '?');

  // iterate over all test accounts
  for (let i = 0, n = chainData.check_accounts.length; i < n; i++) {
    const name = chainData.check_accounts[i].name;
    const accountID = chainData.check_accounts[i].account;
    const plancks = BigInt(chainData.planckPerUnit);

    // balance calculation
    const feesReceived: bigint = db().queryFirstRow('SELECT sum(feeBalances) AS val FROM transactions WHERE authorId=? and height<=?', accountID, atBlock).val || BigInt(0);
    // feesPaid calculated from feeBalances and feeTreasury:
    //const feesPaid: bigint = db().queryFirstRow('SELECT COALESCE(sum(feeBalances), 0)+COALESCE(sum(feeTreasury), 0) AS val FROM transactions WHERE senderId=? and height<=?', accountID, atBlock).val || BigInt(0);
    const feesPaid: bigint = db().queryFirstRow('SELECT sum(totalFee) AS val FROM transactions WHERE senderId=? and height<=?', accountID, atBlock).val || BigInt(0);
    const paid: bigint = db().queryFirstRow('SELECT sum(amount) AS val FROM transactions WHERE senderId=? and height<=?', accountID, atBlock).val || BigInt(0);
    const received: bigint = db().queryFirstRow('SELECT sum(amount) AS val FROM transactions WHERE recipientId=? and height<=?', accountID, atBlock).val || BigInt(0);
    const total: bigint = feesReceived + received - feesPaid - paid;
    const totalD = Divide(total, plancks);

    // balance from API
    const balance = await polkaStore.fetchBalance(atBlock, accountID);
    const balanceTotal = BigInt(balance.reserved) + BigInt(balance.free);
    const balanceTotalD = Divide(balanceTotal, plancks);

    console.log('------------------------------------------',);
    console.log('Account:     %s (%s)', name, accountID);
    console.log('Balance:     %d %s (calculated)', totalD, chainData.unit);
    const diff = Divide(balanceTotal - total, plancks);
    if (!diff) {
      console.log(chalk.green('Balance ok'));
    }
    else {
      console.log('Balance:     %d %s (from API)', balanceTotalD, chainData.unit);
      console.log(chalk.red('Difference:  ' + diff + ' ' + chainData.unit));
    }
  }
}

main().catch(console.error).finally(() => { process.exit() });
