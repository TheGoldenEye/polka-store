// Required imports
import { Divide, LoadConfigFile } from './utils';
import { CPolkaStore } from "./CPolkaStore";
import * as chalk from 'chalk';

import { AssetMetadata } from '@polkadot/types/interfaces';
import { IAssetInfo } from './types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const db = require('better-sqlite3-helper');

// --------------------------------------------------------------
// --------------------------------------------------------------
async function main() {
  // command line parameters:
  // process.argv[2]: chain (optional)
  // process.argv[3]: atBlock (optional)

  const config = LoadConfigFile();
  if (!config)
    return;

  // check given chain
  const chain = process.argv[2] || config.defchain;
  const chainData = config.chains[chain];
  if (!chainData) {
    console.log('Syntax: node build/check.js [chain]');
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
  const api = await polkaStore.InitAPI();

  console.log('##########################################');
  console.log('Chain:', chain);
  if (!chainData.check_accounts.length) {
    console.log('  no accounts given');
    return;
  }

  const lastBlock = Number(db().queryFirstRow('SELECT max(height) AS val FROM transactions').val);
  const sBlock = process.argv[3];   // the block nuber was given by command line?
  const atBlock0 = isNaN(+sBlock) ? lastBlock : Math.min(+sBlock, lastBlock);  // not behind lastBlock
  const atBlock = Number(db().queryFirstRow('SELECT max(height) as val FROM transactions WHERE height<=?', atBlock0)?.val);  //adjust block, if not in database
  const date = db().queryFirstRow('SELECT datetime(timestamp/1000, \'unixepoch\', \'localtime\') as val FROM transactions WHERE height=?', atBlock)?.val;
  console.log('Balance data at Block: %d (%s)', atBlock, date ? date : '?');

  const unit = api.registry.chainTokens[0];
  const decimals = api.registry.chainDecimals[0];
  const plancks = BigInt(Math.pow(10, decimals));

  // Assets available?
  const arrAllAssets = await polkaStore.fetchAllAssets(atBlock);
  const arrAssetMetaData = {};
  arrAllAssets.map((value: IAssetInfo) => {
    arrAssetMetaData[Number(value.assetId)] = value.assetMetaData;
  });
  const assetsAvailable = arrAllAssets.length > 0;

  // iterate over all test accounts
  for (let i = 0, n = chainData.check_accounts.length; i < n; i++) {
    const name = chainData.check_accounts[i].name;
    const accountID = chainData.check_accounts[i].account;

    // balance calculation
    const feesReceived: bigint = db().queryFirstRow('SELECT sum(feeBalances) AS val FROM transactions WHERE authorId=? and height<=?', accountID, atBlock).val || BigInt(0);
    // feesPaid calculated from feeBalances and feeTreasury:
    //const feesPaid: bigint = db().queryFirstRow('SELECT COALESCE(sum(feeBalances), 0)+COALESCE(sum(feeTreasury), 0) AS val FROM transactions WHERE senderId=? and height<=?', accountID, atBlock).val || BigInt(0);
    const feesPaid: bigint = db().queryFirstRow('SELECT sum(totalFee) AS val FROM transactions WHERE senderId=? and height<=?', accountID, atBlock).val || BigInt(0);
    const paid: bigint = db().queryFirstRow('SELECT sum(amount) AS val FROM transactions WHERE senderId=? and height<=?', accountID, atBlock).val || BigInt(0);
    const received: bigint = db().queryFirstRow('SELECT sum(amount) AS val FROM transactions WHERE recipientId=? and height<=?', accountID, atBlock).val || BigInt(0);
    const total: bigint = feesReceived + received - feesPaid - paid;
    const totalD = Divide(total, plancks);
    const bonded: bigint = db().queryFirstRow('SELECT sum(amount) AS val FROM transactions WHERE (event=\'staking.Bonded\' or event=\'staking.Unbonded\') and addData=? and height<=?', accountID, atBlock).val || BigInt(0);
    const bondedD = Divide(bonded, plancks);

    // balance from API
    const balanceApi = await polkaStore.fetchBalance(atBlock, accountID);
    const balanceApiTotal = BigInt(balanceApi.reserved.toString()) + BigInt(balanceApi.free.toString());
    const balanceApiTotalD = Divide(balanceApiTotal, plancks);
    const si = await polkaStore.fetchStakingInfo(atBlock, accountID);
    const bondedApi = si ? si.staking.active.toBigInt() : BigInt(0);
    const bondedApiD = Divide(bondedApi, plancks);
    const diffBalance = Divide(balanceApiTotal - total, plancks);
    const diffBonded = Divide(bondedApi - bonded, plancks);

    let stBalanceAssets = "";
    if (assetsAvailable) {
      const balanceAssets = await polkaStore.fetchAssetBalances(atBlock, accountID);
      if (balanceAssets.assets.length) {
        for (let i = 0, n = balanceAssets.assets.length; i < n; i++) {
          const balance = balanceAssets.assets[i].balance.toBigInt();
          const assetId = Number(balanceAssets.assets[i].assetId);
          const amd = arrAssetMetaData[assetId];
          stBalanceAssets += (stBalanceAssets > "" ? ", " : " ") + Divide(balance, BigInt(Math.pow(10, amd.decimals.toNumber())));
          stBalanceAssets += " " + amd.symbol.toHuman();
        }
      }
      if (stBalanceAssets > "")
        stBalanceAssets = "Assets: " + stBalanceAssets;
    }

    console.log('------------------------------------------',);
    console.log('Account: %s (%s)', name, accountID);

    if (!diffBalance)
      console.log(`Balance: ${totalD} ${unit}`);
    else
      console.log(chalk.red(`Balance: ${totalD} ${unit} (calculated) / ${balanceApiTotalD} ${unit} (from API) / Difference: ${diffBalance} ${unit}`));

    if (stBalanceAssets > "")
      console.log(stBalanceAssets);

    if (!diffBonded)
      console.log(`Bonded:  ${bondedD} ${unit}`);
    else
      console.log(chalk.red(`Bonded:  ${bondedD} ${unit} (calculated) / ${bondedApiD} ${unit} (from API) / Difference: ${diffBonded} ${unit}`));
  }
}

main().catch(console.error).finally(() => { process.exit() });
