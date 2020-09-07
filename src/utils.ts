// Required imports
import { ApiPromise, WsProvider } from '@polkadot/api';
import { BlockHash, RuntimeDispatchInfo, RuntimeVersion } from '@polkadot/types/interfaces'
import { IBlock, IExtrinsic, ISanitizedEvent, IOnInitializeOrFinalize } from './types';
import ApiHandler from './ApiHandler';
import CTxDB, { TTransaction } from './db';
import * as getPackageVersion from '@jsbits/get-package-version'

// --------------------------------------------------------------
// initialize polkadot API

export async function InitAPI(providers: string[], expectedChain: string): Promise<ApiPromise> {

  const ver = getPackageVersion();

  // Find suitable API provider
  let selProvider = "";
  let api: ApiPromise | undefined = undefined;

  for (let i = 0, n = providers.length; i < n && !api?.isConnected; i++) {
    try {
      selProvider = providers[i];
      const provider = new WsProvider(selProvider);

      // Create the API and check if ready
      api = new ApiPromise({ provider });
      await api.isReadyOrError;
    }
    catch (e) {
      api?.disconnect();
    }
  }
  if (!api)
    throw ('Cannot find suitable provider to connect');

  // Retrieve the chain & node information information via rpc calls
  const [chain, nodeName, nodeVersion] = await Promise.all([
    api.rpc.system.chain(),
    api.rpc.system.name(),
    api.rpc.system.version()
  ]);

  console.log(`polka-store: v${ver}`);
  console.log(`Chain:       ${chain}`);
  console.log(`Node:        ${nodeName} v${nodeVersion}`);
  console.log(`Provider:    ${selProvider}`);
  console.log(`API:         ${api.libraryInfo}\n`);

  if (chain.toString() != expectedChain) {
    console.log('Wrong chain!\nGot "%s" chain, but expected "%s" chain.', chain.toString(), expectedChain);
    console.log('Process aborted.\n');
    process.exit(1);
  }
  return api;
}

// --------------------------------------------------------------
export async function ProcessBlockData(api: ApiPromise, handler: ApiHandler, db: CTxDB, blockNr: number): Promise<void> {
  const hash = await api.rpc.chain.getBlockHash(blockNr);
  return ProcessBlockDataH(api, handler, db, hash);
}

// --------------------------------------------------------------
export async function ProcessBlockDataH(api: ApiPromise, handler: ApiHandler, db: CTxDB, hash: BlockHash): Promise<void> {
  const block = await handler.fetchBlock(hash);
  return ProcessBlockDataB(api, handler, db, block);
}

// --------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export async function ProcessBlockDataB(api: ApiPromise, handler: ApiHandler, db: CTxDB, block: IBlock): Promise<void> {
  const txs: TTransaction[] = [];

  const methodsToScan = ['utility.batch', 'proxy.proxy', 'staking.payoutStakers', 'balances.transfer', 'balances.transferKeepAlive']

  // 1. process events attached directly to block
  ProcessStakingSlashEvents(block, block.onInitialize, db, txs);

  // 2. process extrinsics
  for (let exIdx = 0, n = block.extrinsics.length; exIdx < n; exIdx++) {
    const ex = block.extrinsics[exIdx];
    const method = ex.method;

    const ver = await api.rpc.state.getRuntimeVersion(block.parentHash);  // get runtime version of the block

    // 2.1 process all signed transactions (stores the fee / tip)
    ProcessGeneral(block, ex, exIdx, db, ver, txs);

    // 2.2 process events attached to extrinsics
    if (methodsToScan.includes(method)) {
      ex.events.forEach((ev: ISanitizedEvent, evIdx: number) => {
        //console.log(block.number + '-' + exIdx + '_ev' + evIdx, ev.method);

        ProcessTransferEvents(block, ex, exIdx, ev, evIdx, db, txs);
        ProcessStakingRewardEvents(block, ex, exIdx, ev, evIdx, db, txs);
        ProcessReserveRepatriatedEvents(block, ex, exIdx, ev, evIdx, db, txs);
      });
    }
  }

  db.InsertTransactions(txs);
}

// --------------------------------------------------------------
// process block events
function ProcessStakingSlashEvents(block: IBlock, onIF: IOnInitializeOrFinalize, db: CTxDB, txs: TTransaction[]): void {
  onIF.events.forEach((ev: ISanitizedEvent, index: number) => {
    if (ev.method == 'staking.Slash') {

      const tx: TTransaction = {
        chain: db.chain,
        id: block.number + '_onInitialize_ev' + index,
        height: Number(block.number),
        blockHash: block.hash.toString(),
        type: ev.method,     // exceptionally we use here the event method, because there is no extrinsic
        subType: undefined,
        event: ev.method,
        timestamp: GetTime(block.extrinsics),
        specVersion: undefined,
        transactionVersion: undefined,
        authorId: block.authorId ? block.authorId.toString() : undefined,
        senderId: ev.data[0].toString(),
        recipientId: undefined,
        amount: BigInt(ev.data[1]),
        partialFee: undefined,
        feeBalances: undefined,
        feeTreasury: undefined,
        tip: undefined,
        paysFee: undefined,
        success: undefined
      };

      txs.push(tx);
    }
  });
}

// --------------------------------------------------------------
// process general extrinsics
function ProcessGeneral(block: IBlock, ex: IExtrinsic, idxEx: number, db: CTxDB, ver: RuntimeVersion, txs: TTransaction[]): void {

  if (ex.signature) { // there is a signer
    const pf = (<RuntimeDispatchInfo>ex.info).partialFee;

    let subType: string | undefined = undefined;
    const method = ex.method;
    if (method == 'proxy.proxy' || method == 'utility.batch') {
      if (ex.newArgs.call)
        subType = ex.newArgs.call.method
      else if (ex.newArgs.calls) {
        const arr: string[] = [];
        ex.newArgs.calls.forEach(arg => {
          if (!arr.includes(arg.method))
            arr.push(arg.method);
        })
        subType = arr.join();
      }
    }

    const tx: TTransaction = {
      chain: db.chain,
      id: block.number + '-' + idxEx,
      height: Number(block.number),
      blockHash: block.hash.toString(),
      type: method,
      subType: subType,
      event: undefined,
      timestamp: GetTime(block.extrinsics),
      specVersion: ver.specVersion.toNumber(),
      transactionVersion: ver.transactionVersion.toNumber(),
      authorId: block.authorId ? block.authorId.toString() : undefined,
      senderId: ex.signature.signer.toString(),
      recipientId: undefined,
      amount: undefined,
      partialFee: pf ? BigInt(pf) : undefined,  // pf can be undefined: maybe "Fee calculation not supported for westend#8"
      feeBalances: undefined,
      feeTreasury: undefined,
      tip: BigInt(ex.tip),
      paysFee: ex.paysFee ? 1 : 0,
      success: ex.success ? 1 : 0
    };

    GetFee2(ex, tx); // calculate 2nd fee based on balances.Deposit and treasury.Deposit events

    txs.push(tx);
  }
}


// --------------------------------------------------------------
// process transfer events
function ProcessTransferEvents(block: IBlock, ex: IExtrinsic, exIdx: number, ev: ISanitizedEvent, evIdx: number, db: CTxDB, txs: TTransaction[]): void {
  if (ev.method == 'balances.Transfer') {

    const tx: TTransaction = {
      chain: db.chain,
      id: block.number + '-' + exIdx + '_ev' + evIdx,
      height: Number(block.number),
      blockHash: block.hash.toString(),
      type: ex.method,
      subType: undefined,
      event: ev.method,
      timestamp: GetTime(block.extrinsics),
      specVersion: undefined,
      transactionVersion: undefined,
      authorId: undefined,
      senderId: ev.data[0].toString(),
      recipientId: ev.data[1].toString(),
      amount: BigInt(ev.data[2]),
      partialFee: undefined,
      feeBalances: undefined,
      feeTreasury: undefined,
      tip: undefined,
      paysFee: undefined,
      success: undefined
    };

    txs.push(tx);
  }
}

// --------------------------------------------------------------
// process staking.Reward events
function ProcessStakingRewardEvents(block: IBlock, ex: IExtrinsic, exIdx: number, ev: ISanitizedEvent, evIdx: number, db: CTxDB, txs: TTransaction[]): void {
  if (ev.method == 'staking.Reward') {

    const tx: TTransaction = {
      chain: db.chain,
      id: block.number + '-' + exIdx + '_ev' + evIdx,
      height: Number(block.number),
      blockHash: block.hash.toString(),
      type: ex.method,
      subType: undefined,
      event: ev.method,
      timestamp: GetTime(block.extrinsics),
      specVersion: undefined,
      transactionVersion: undefined,
      authorId: undefined,
      senderId: undefined,
      recipientId: ev.data[0].toString(),
      amount: BigInt(ev.data[1]),
      partialFee: undefined,
      feeBalances: undefined,
      feeTreasury: undefined,
      tip: undefined,
      paysFee: undefined,
      success: undefined
    };

    txs.push(tx);
  }
}

// --------------------------------------------------------------
// process balance.ReserveRepatriated events (use reserved funds)
function ProcessReserveRepatriatedEvents(block: IBlock, ex: IExtrinsic, exIdx: number, ev: ISanitizedEvent, evIdx: number, db: CTxDB, txs: TTransaction[]): void {
  if (ev.method == 'balances.ReserveRepatriated') {

    const tx: TTransaction = {
      chain: db.chain,
      id: block.number + '-' + exIdx + '_ev' + evIdx,
      height: Number(block.number),
      blockHash: block.hash.toString(),
      type: ex.method,
      subType: undefined,
      event: ev.method,
      timestamp: GetTime(block.extrinsics),
      specVersion: undefined,
      transactionVersion: undefined,
      authorId: undefined,
      senderId: ev.data[0].toString(),
      recipientId: ev.data[1].toString(),
      amount: BigInt(ev.data[2]),
      partialFee: undefined,
      feeBalances: undefined,
      feeTreasury: undefined,
      tip: undefined,
      paysFee: undefined,
      success: undefined
    };

    txs.push(tx);
  }
}

// --------------------------------------------------------------
// looks for balance.Deposit method with fee infomation and sets this in tx
function GetFee2(ex: IExtrinsic, tx: TTransaction): boolean {
  if (ex.paysFee)
    ex.events.forEach((ev: ISanitizedEvent) => {
      if (ev.method == 'balances.Deposit') {
        tx.feeBalances = BigInt(ev.data[1]);
      }
      else if (ev.method == 'treasury.Deposit') {
        tx.feeTreasury = BigInt(ev.data[0]);
      }
    });
  return !ex.paysFee || (tx.feeBalances != undefined);
}

// --------------------------------------------------------------
// block number console output 
// only one output in the given time interval
export default class CLogBlockNr {
  private _api: ApiPromise;
  private _lastBlock: number;
  private _lastLoggedBlock: number;
  private _lastLoggingTime: Date;

  constructor(api: ApiPromise, lastBlock: number) {
    this._api = api;
    this._lastBlock = lastBlock;
    this._lastLoggedBlock = 0;
  }

  async LogBlock(blockNr: number, force = false, minTime = 6000): Promise<void> {
    if (!this._lastLoggingTime) {  // first call
      this._lastLoggedBlock = blockNr;
      this._lastLoggingTime = new Date();
    }

    const d = new Date();
    const diff = d.getTime() - this._lastLoggingTime.getTime();
    if (force || diff >= minTime) {
      const header = await this._api.rpc.chain.getHeader();
      this._lastBlock = Number(header.number);

      const timePerBlock = Math.round(diff * 10 / (blockNr - this._lastLoggedBlock)) / 10;  // rounded to one decimal place
      const timeLeft = Math.floor(timePerBlock * (this._lastBlock - blockNr) / 1000);
      const s = timeLeft % 60
      const m = Math.floor(timeLeft / 60) % 60;
      const h = Math.floor(timeLeft / 3600);
      console.log('Block %d / %d, %f ms/block, time left: %d hours %d min %d sec', blockNr, this._lastBlock, timePerBlock, h, m, s);
      this._lastLoggingTime = d;
      this._lastLoggedBlock = blockNr;
    }
  }

  LastBlock(): number {
    return this._lastBlock;
  }

}

// --------------------------------------------------------------
// wait ms milliseconds
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}


// --------------------------------------------------------------
// get block timestamp
export function GetTime(extrinsics: IExtrinsic[]): number {
  if (extrinsics[0].method != 'timestamp.set')
    return 0;

  const d = new Date(Number(extrinsics[0].args[0]));
  return d.getTime();
}


