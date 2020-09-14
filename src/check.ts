// Required imports
import * as config from './config.json';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const db = require('better-sqlite3-helper');


// --------------------------------------------------------------
// --------------------------------------------------------------
async function main() {
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

  console.log('##########################################',);
  console.log('Chain:', chain);

  // iterate over all test accounts
  chainData.test_accounts.forEach((accountID: string) => {
    const lastBlock = db().queryFirstRow('SELECT max(height) AS val FROM transactions').val;
    const feesReceived = db().queryFirstRow('SELECT sum(feeBalances) AS val FROM transactions WHERE authorId=?', accountID).val;
    //const feesPaid = db().queryFirstRow('SELECT COALESCE(sum(partialFee), 0)+COALESCE(sum(tip), 0) AS val FROM transactions WHERE senderId=?', accountID).val;
    // the fees calculated in partialFee are not always correct (Westend only)
    // we use the fallback: fee = feeBalances + feeTreasury
    const feesPaid = db().queryFirstRow('SELECT COALESCE(sum(feeBalances), 0)+COALESCE(sum(feeTreasury), 0) AS val FROM transactions WHERE senderId=?', accountID).val;
    const paid = db().queryFirstRow('SELECT sum(amount) AS val FROM transactions WHERE senderId=?', accountID).val;
    const received = db().queryFirstRow('SELECT sum(amount) AS val FROM transactions WHERE recipientId=?', accountID).val;
    const total = feesReceived + received - feesPaid - paid;
    const plancks: number = chainData.PlanckPerUnit;

    console.log('------------------------------------------',);
    console.log('AccointID:   ', accountID);
    console.log('feesReceived:', feesReceived / plancks);
    console.log('feesPaid:    ', feesPaid / plancks);
    console.log('paid:        ', paid / plancks);
    console.log('received:    ', received / plancks);
    console.log('Balance at Block %d: %d', lastBlock, total / plancks);
  });

}

main().catch(console.error).finally(() => { process.exit() });