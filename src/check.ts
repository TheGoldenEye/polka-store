// Required imports
import { Divide, LoadConfigFile } from './utils';
import { CPolkaStore } from "./CPolkaStore";
import * as chalk from 'chalk';

import { Vec } from '@polkadot/types';
//import { Codec } from '@polkadot/types/types';
import { Option } from '@polkadot/types/codec';
import { u128 } from '@polkadot/types/primitive';
import { AssetMetadata } from '@polkadot/types/interfaces';

import { ApiDecoration } from '@polkadot/api/types';
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

  const check_ignoreDB: boolean = chainData.check_ignoreDB ? chainData.check_ignoreDB : false;

  // open database
  const options = {
    path: config.filename || 'data/' + chain + '.db',
    readonly: false,
    fileMustExist: true, // throw error if database not exists
    WAL: false, // automatically enable 'PRAGMA journal_mode = WAL'?
    migrate: false,
  }
  if (!check_ignoreDB) {
    db(options);
    db().defaultSafeIntegers(true);
  }

  process.on('exit', () => db().close());     // close database on exit

  const polkaStore = new CPolkaStore(chainData, chain);
  const api = await polkaStore.InitAPI();

  console.log('##########################################');
  console.log('Chain:', chain);
  if (!chainData.check_accounts.length) {
    console.log('  no accounts given');
    return;
  }
  const lastBlock = check_ignoreDB ? await polkaStore.LastBlock() : Number(db().queryFirstRow('SELECT max(height) AS val FROM transactions').val);
  const sBlock = process.argv[3];   // the block nuber was given by command line?
  const atBlock0 = isNaN(+sBlock) ? lastBlock : Math.min(+sBlock, lastBlock);  // not behind lastBlock
  const atBlock = check_ignoreDB ? atBlock0 : Number(db().queryFirstRow('SELECT max(height) as val FROM transactions WHERE height<=?', atBlock0)?.val);  //adjust block, if not in database
  const date = db().queryFirstRow('SELECT datetime(timestamp/1000, \'unixepoch\', \'localtime\') as val FROM transactions WHERE height=?', atBlock)?.val;
  console.log('Balance data at Block: %d (%s)', atBlock, date ? date : '?');

  const hash = await api.rpc.chain.getBlockHash(atBlock);
  const apiAt = await api.at(hash);

  const unit = api.registry.chainTokens[0];
  const decimals = api.registry.chainDecimals[0];
  const plancks = BigInt(Math.pow(10, decimals));

  const isRelayChain = ["Polkadot", "Kusama", "Westend"].includes(chain);

  // Assets available?
  const arrAllAssets = await polkaStore.fetchAllAssets(atBlock);
  const arrAssetMetaData: Record<number, AssetMetadata> = {};
  arrAllAssets.map((value: IAssetInfo) => {
    arrAssetMetaData[Number(value.assetId)] = value.assetMetaData;
  });
  const assetsAvailable = arrAllAssets.length > 0;

  // iterate over all test accounts
  for (let i = 0, n = chainData.check_accounts.length; i < n; i++) {
    const name = chainData.check_accounts[i].name;
    const accountID = chainData.check_accounts[i].account;

    // balance calculation
    const feesReceived: bigint = check_ignoreDB ? 0 : db().queryFirstRow('SELECT sum(feeBalances) AS val FROM transactions WHERE authorId=? and height<=?', accountID, atBlock).val || BigInt(0);
    const feesPaid: bigint = check_ignoreDB ? 0 : db().queryFirstRow('SELECT sum(totalFee) AS val FROM transactions WHERE senderId=? and height<=?', accountID, atBlock).val || BigInt(0);
    const paid: bigint = check_ignoreDB ? 0 : db().queryFirstRow('SELECT sum(amount) AS val FROM transactions WHERE senderId=? and height<=?', accountID, atBlock).val || BigInt(0);
    const received: bigint = check_ignoreDB ? 0 : db().queryFirstRow('SELECT sum(amount) AS val FROM transactions WHERE recipientId=? and height<=?', accountID, atBlock).val || BigInt(0);
    const total: bigint = feesReceived + received - feesPaid - paid;
    const totalD = Divide(total, plancks);
    const bonded: bigint = check_ignoreDB ? 0 : db().queryFirstRow('SELECT sum(amount) AS val FROM transactions WHERE (event=\'staking.Bonded\' or event=\'staking.Unbonded\') and addData=? and height<=?', accountID, atBlock).val || BigInt(0);
    const bondedD = Divide(bonded, plancks);

    // balance from API
    const balanceApi = await polkaStore.fetchBalance(atBlock, accountID);
    const balanceApiTotal = BigInt(balanceApi.reserved.toString()) + BigInt(balanceApi.free.toString());
    const balanceApiTotalD = Divide(balanceApiTotal, plancks);
    const si = await polkaStore.fetchStakingInfo(atBlock, accountID);
    const bondedApi = si ? si.staking.active.toBigInt() : BigInt(0);
    const bondedApiD = Divide(bondedApi, plancks);
    const diffBalance = check_ignoreDB ? 0 : Divide(balanceApiTotal - total, plancks);
    const diffBonded = check_ignoreDB ? 0 : Divide(bondedApi - bonded, plancks);

    let stBalanceAssets = "";
    let stLoanAssets = "";
    let stStreamAssets = "";
    if (assetsAvailable) {
      const balanceAssets = await polkaStore.fetchAssetBalances(atBlock, accountID);
      if (balanceAssets.assets.length) {
        for (let i = 0, n = balanceAssets.assets.length; i < n; i++) {
          const balance = balanceAssets.assets[i].balance.toBigInt();
          if (balance > 0) {
            const assetId = Number(balanceAssets.assets[i].assetId);
            const amd = arrAssetMetaData[assetId];
            stBalanceAssets += (stBalanceAssets > "" ? ", " : " ") + Divide(balance, BigInt(Math.pow(10, amd.decimals.toNumber())));
            stBalanceAssets += " " + amd.symbol.toHuman();
          }
        }
      }
      if (stBalanceAssets > "")
        stBalanceAssets = "Assets: " + stBalanceAssets;

      if (apiAt.query.loans) { // Only, if the runtime includes loans pallet at this block
        for (let i = 0, n = arrAllAssets.length; i < n; i++) {
          const assetId = arrAllAssets[i].assetId as number;
          const b = await getLoan(assetId, arrAssetMetaData[assetId], accountID, apiAt);
          if (b?.balance) {
            stLoanAssets += (stLoanAssets > "" ? ", " : " ") + b.balance + " " + b.symbol;
          }
        }
        if (stLoanAssets > "")
          stLoanAssets = "Lend:   " + stLoanAssets;
      }

      if (apiAt.query.streaming) { // Only, if the runtime includes streaming pallet at this block
        const arrStreamBal = await getStreaming(accountID, apiAt);
        if (arrStreamBal)
          for (let i = 0, n = arrStreamBal.length; i < n; i++) {
            const sb = arrStreamBal[i];
            const amd = arrAssetMetaData[sb.assetId];
            const decimals = amd ? amd.decimals.toNumber() : api.registry.chainDecimals[0];
            const symbol = amd ? amd.symbol.toHuman() : api.registry.chainTokens[0];
            const v = Divide(sb.remainingBalance, BigInt(Math.pow(10, decimals)));
            stStreamAssets += (stStreamAssets > "" ? ", " : " ") + v + " " + symbol;
          }

        if (stStreamAssets > "")
          stStreamAssets = "Stream: " + stStreamAssets;
      }
    }

    console.log('------------------------------------------',);
    console.log('Account: %s (%s)', name, accountID);

    if (!diffBalance && !balanceApiTotalD && stBalanceAssets == "") { // empty account
      //      console.log("  empty");
      continue;
    }

    if (!diffBalance)
      console.log(`  Balance: ${balanceApiTotalD} ${unit}`);
    else
      console.log(chalk.red(`  Balance: ${totalD} ${unit} (calculated) / ${balanceApiTotalD} ${unit} (from API) / Difference: ${diffBalance} ${unit}`));

    if (stBalanceAssets > "")
      console.log("  " + stBalanceAssets);
    if (stLoanAssets > "")
      console.log("  " + stLoanAssets);
    if (stStreamAssets > "")
      console.log("  " + stStreamAssets);

    if (isRelayChain) {
      if (!diffBonded)
        console.log(`  Bonded:  ${bondedApiD} ${unit}`);
      else
        console.log(chalk.red(`  Bonded:  ${bondedD} ${unit} (calculated) / ${bondedApiD} ${unit} (from API) / Difference: ${diffBonded} ${unit}`));
    }
  }
}

main().catch(console.error).finally(() => { process.exit() });

// --------------------------------------------------------------
export interface LoanBalance { balance: number; assetId: number; symbol: string; }

async function getLoan(assetId: number, amd: AssetMetadata, accountID: string, apiAt: ApiDecoration<"promise">): Promise<LoanBalance | undefined> {
  if (!apiAt.query.loans)
    return undefined;

  const symbol = amd.symbol.toHuman()?.toString();
  if (!symbol)
    return undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deposit = BigInt((await apiAt.query.loans.accountDeposits(assetId, accountID) as any).voucherBalance.toString());

  if (!deposit)
    return { balance: 0, assetId: assetId, symbol: symbol }

  const e = BigInt((await apiAt.query.loans.exchangeRate(assetId)).toString());
  const v = Divide(deposit * e, BigInt(10 ** (18 + amd.decimals.toNumber())));
  return { balance: v, assetId: assetId, symbol: symbol }
}

// --------------------------------------------------------------
/*
export interface PalletStreamingStream {
  remainingBalance: u128,
  deposit: u128,
  assetId: u32,
  ratePerSec: u128,
  sender: AccountId32,
  recipient: AccountId32,
  startTime: u64,
  endTime: u64,
  status: PalletStreamingStreamStatus,
  cancellable: bool
}; 
*/

export interface StreamData {
  remainingBalance: bigint,
  deposit: bigint,
  assetId: number,
  ratePerSec: bigint,
  sender: string,
  recipient: string,
  startTime: Date,
  endTime: Date,
}

async function getStreaming(accountID: string, apiAt: ApiDecoration<"promise">): Promise<StreamData[] | undefined> {
  if (!apiAt.query.streaming)
    return undefined;

  const ret: StreamData[] = [];
  const optStreamIds = await apiAt.query.streaming.streamLibrary(accountID, "Receive") as Option<Vec<u128>>;
  if (optStreamIds.isSome) {
    const arrStreamIds = optStreamIds.unwrap();
    for (let i = 0, n = arrStreamIds.length; i < n; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const optStreamData = await apiAt.query.streaming.streams(arrStreamIds[i]) as Option<any>;
      if (optStreamData.isSome) {
        const streamData = optStreamData.unwrap();
        const sd: StreamData = {
          remainingBalance: streamData.remainingBalance.toBigInt(),
          deposit: streamData.deposit.toBigInt(),
          assetId: streamData.assetId.toNumber(),
          ratePerSec: streamData.ratePerSec.toBigInt(),
          sender: streamData.sender.toString(),
          recipient: streamData.recipient.toString(),
          startTime: new Date(streamData.startTime.toNumber() * 1000),
          endTime: new Date(streamData.endTime.toNumber() * 1000),
        }
        ret.push(sd);

      }
    }
  }
  return ret;
}
