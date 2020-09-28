// Required imports
import { ApiPromise, WsProvider } from '@polkadot/api';
import { BlockHash, RuntimeDispatchInfo, RuntimeVersion } from '@polkadot/types/interfaces'
import { IBlock, IExtrinsic, ISanitizedEvent, IOnInitializeOrFinalize } from './types';
import ApiHandler from './ApiHandler';
import CTxDB, { TTransaction } from './db';
import * as getPackageVersion from '@jsbits/get-package-version'
import * as fs from 'fs';
import * as Ajv from 'ajv';

type TBlockData = {
  api: ApiPromise,
  handler: ApiHandler,
  blockNr: number,
  blockHash: BlockHash,
  block: IBlock,
  db: CTxDB,
  txs: TTransaction[],
  chain: string,
};

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
export async function ProcessBlockData(api: ApiPromise, handler: ApiHandler, db: CTxDB, blockNr: number, chain: string): Promise<void> {
  const data: TBlockData = {
    api: api,
    handler: handler,
    block: <IBlock><unknown>0,
    blockHash: <BlockHash><unknown>0,
    blockNr: blockNr,
    txs: [],
    db: db,
    chain: chain
  }

  try {
    data.blockHash = await api.rpc.chain.getBlockHash(blockNr);
  }
  catch (e) {
    console.error('BlockNr:', blockNr, 'ProcessBlockData(): Error:', (e as Error).message)
  }
  return ProcessBlockDataH(data);
}

// --------------------------------------------------------------
export async function ProcessBlockDataH(data: TBlockData): Promise<void> {
  try {
    data.block = await data.handler.fetchBlock(data.blockHash);
  }
  catch (e) {
    console.error('BlockNr:', data.blockNr, 'ProcessBlockDataH(): Error:', (e as Error).message)
  }

  return ProcessBlockDataB(data);
}

// --------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export async function ProcessBlockDataB(data: TBlockData): Promise<void> {
  try {
    await Promise.all([
      ProcessStakingSlashEvents(data, data.block.onInitialize),   // 1. process events attached directly to block
      ProcessExtrinsics(data)                                     // 2. process extrinsics
    ])

    data.db.InsertTransactions(data.txs);
  }
  catch (e) {
    console.error('BlockNr:', data.blockNr, 'ProcessBlockDataB(): Error:', (e as Error).message)
  }
}

// --------------------------------------------------------------
// process block events
async function ProcessStakingSlashEvents(data: TBlockData, onIF: IOnInitializeOrFinalize): Promise<void> {
  onIF.events.forEach((ev: ISanitizedEvent, index: number) => {
    if (ev.method == 'staking.Slash') {

      const tx: TTransaction = {
        chain: data.db.chain,
        id: data.block.number + '_onInitialize_ev' + index,
        height: data.block.number.toNumber(),
        blockHash: data.block.hash.toString(),
        type: ev.method,     // exceptionally we use here the event method, because there is no extrinsic
        subType: undefined,
        event: ev.method,
        timestamp: GetTime(data.block.extrinsics),
        specVersion: undefined,
        transactionVersion: undefined,
        authorId: data.block.authorId?.toString(),
        senderId: ev.data[0].toString(),
        recipientId: undefined,
        amount: BigInt(ev.data[1]),
        //        totalFee: undefined,
        partialFee: undefined,
        feeBalances: undefined,
        feeTreasury: undefined,
        tip: undefined,
        success: undefined
      };

      data.txs.push(tx);
    }
  });
}

// --------------------------------------------------------------
// process general extrinsics
async function ProcessExtrinsics(data: TBlockData): Promise<void> {

  const methodsToScan = [
    'utility.batch', 'proxy.proxy', 'multisig.asMulti',
    'staking.payoutStakers', 'balances.transfer', 'balances.transferKeepAlive',
    'identity.requestJudgement'   // for ProcessMissingEvents
  ]

  const ver = await data.api.rpc.state.getRuntimeVersion(data.block.parentHash);  // get runtime version of the block

  for (let exIdx = 0, n = data.block.extrinsics.length; exIdx < n; exIdx++) {
    const ex = data.block.extrinsics[exIdx];
    const method = ex.method;

    // 1. process all signed transactions (stores the fee / tip)
    ProcessGeneral(data, ex, exIdx, ver);

    // 2. process events attached to extrinsics
    /*
        if (methodsToScan.includes(method))
          await Promise.all(ex.events.map(async (ev: ISanitizedEvent, evIdx: number) => {
            await ProcessEvents(data, ex, exIdx, ev, evIdx, ver.specVersion.toNumber());
          }));
    */
    // sequential:
    if (methodsToScan.includes(method))
      for (let i = 0, n = ex.events.length; i < n; i++)
        await ProcessEvents(data, ex, exIdx, ex.events[i], i, ver.specVersion.toNumber());
  }


}

// --------------------------------------------------------------
// process general extrinsics
function ProcessGeneral(data: TBlockData, ex: IExtrinsic, idxEx: number, ver: RuntimeVersion): void {

  if (ex.signature) { // there is a signer
    const pf = (<RuntimeDispatchInfo>ex.info).partialFee;

    let subType: string | undefined = undefined;
    const method = ex.method;
    if (method == 'proxy.proxy' || method == 'utility.batch') {
      if (ex.newArgs.call) {
        subType = ex.newArgs.call.method;
      }
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
      chain: data.db.chain,
      id: data.block.number + '-' + idxEx,
      height: data.block.number.toNumber(),
      blockHash: data.block.hash.toString(),
      type: method,
      subType: subType,
      event: undefined,
      timestamp: GetTime(data.block.extrinsics),
      specVersion: ver.specVersion.toNumber(),
      transactionVersion: ver.transactionVersion.toNumber(),
      authorId: data.block.authorId?.toString(),
      senderId: ex.signature.signer.toString(),
      recipientId: undefined,
      amount: undefined,
      //      totalFee: undefined,
      partialFee: pf ? BigInt(pf) : undefined,  // pf can be undefined: maybe because "Fee calculation not supported for westend#8"
      feeBalances: undefined,
      feeTreasury: undefined,
      tip: BigInt(ex.tip),
      success: ex.success ? 1 : 0
    };

    CalcTotalFee(ex, tx); // calculate totalFee fee based on balances.Deposit and treasury.Deposit events

    data.txs.push(tx);
  }
}


// --------------------------------------------------------------
// process all event
async function ProcessEvents(data: TBlockData, ex: IExtrinsic, exIdx: number, ev: ISanitizedEvent, evIdx: number, specVer: number): Promise<void> {
  //console.log(data.block.number + '-' + exIdx + '_ev' + evIdx, ev.method);
  await Promise.all([
    ProcessTransferEvents(data, ex, exIdx, ev, evIdx),
    ProcesDustLostEvents(data, ex, exIdx, ev, evIdx),
    ProcessStakingRewardEvents(data, ex, exIdx, ev, evIdx),
    ProcessReserveRepatriatedEvents(data, ex, exIdx, ev, evIdx),
    ProcessMissingEvents(data, ex, exIdx, ev, evIdx, specVer)
  ]);

}

// --------------------------------------------------------------
// process transfer events
async function ProcessTransferEvents(data: TBlockData, ex: IExtrinsic, exIdx: number, ev: ISanitizedEvent, evIdx: number): Promise<void> {
  if (ev.method == 'balances.Transfer') {

    const tx: TTransaction = {
      chain: data.db.chain,
      id: data.block.number + '-' + exIdx + '_ev' + evIdx,
      height: data.block.number.toNumber(),
      blockHash: data.block.hash.toString(),
      type: ex.method,
      subType: undefined,
      event: ev.method,
      timestamp: GetTime(data.block.extrinsics),
      specVersion: undefined,
      transactionVersion: undefined,
      authorId: undefined,
      senderId: ev.data[0].toString(),
      recipientId: ev.data[1].toString(),
      amount: BigInt(ev.data[2]),
      //      totalFee: undefined,
      partialFee: undefined,
      feeBalances: undefined,
      feeTreasury: undefined,
      tip: undefined,
      success: undefined
    };

    data.txs.push(tx);
  }
}

// --------------------------------------------------------------
// process transfer events
async function ProcesDustLostEvents(data: TBlockData, ex: IExtrinsic, exIdx: number, ev: ISanitizedEvent, evIdx: number): Promise<void> {
  if (ev.method == 'balances.DustLost') {

    const tx: TTransaction = {
      chain: data.db.chain,
      id: data.block.number + '-' + exIdx + '_ev' + evIdx,
      height: data.block.number.toNumber(),
      blockHash: data.block.hash.toString(),
      type: ex.method,
      subType: undefined,
      event: ev.method,
      timestamp: GetTime(data.block.extrinsics),
      specVersion: undefined,
      transactionVersion: undefined,
      authorId: undefined,
      senderId: ev.data[0].toString(),
      recipientId: undefined,
      amount: BigInt(ev.data[1]),
      //      totalFee: undefined,
      partialFee: undefined,
      feeBalances: undefined,
      feeTreasury: undefined,
      tip: undefined,
      success: undefined
    };

    data.txs.push(tx);
  }
}

// --------------------------------------------------------------
// process staking.Reward events
async function ProcessStakingRewardEvents(data: TBlockData, ex: IExtrinsic, exIdx: number, ev: ISanitizedEvent, evIdx: number): Promise<void> {
  if (ev.method == 'staking.Reward') {

    const stashId = ev.data[0].toString();  // AcountID of validator
    let payee = stashId;                    // init payee

    // get reward destination from api
    const rd = await data.api.query.staking.payee.at(data.block.hash, stashId);
    if (rd.isAccount)                       // reward dest: an explicitely given account 
      payee = rd.asAccount.toString();
    else if (rd.isController)               // reward dest: the controller account
      payee = (await data.api.query.staking.bonded.at(data.block.hash, stashId)).toString();

    const tx: TTransaction = {
      chain: data.db.chain,
      id: data.block.number + '-' + exIdx + '_ev' + evIdx,
      height: data.block.number.toNumber(),
      blockHash: data.block.hash.toString(),
      type: ex.method,
      subType: undefined,
      event: ev.method,
      timestamp: GetTime(data.block.extrinsics),
      specVersion: undefined,
      transactionVersion: undefined,
      authorId: undefined,
      senderId: undefined,
      recipientId: payee,
      amount: BigInt(ev.data[1]),
      //      totalFee: undefined,
      partialFee: undefined,
      feeBalances: undefined,
      feeTreasury: undefined,
      tip: undefined,
      success: undefined
    };

    data.txs.push(tx);
  }
}

// --------------------------------------------------------------
// process balance.ReserveRepatriated events (use reserved funds)
async function ProcessReserveRepatriatedEvents(data: TBlockData, ex: IExtrinsic, exIdx: number, ev: ISanitizedEvent, evIdx: number): Promise<void> {
  if (ev.method == 'balances.ReserveRepatriated') {

    const tx: TTransaction = {
      chain: data.db.chain,
      id: data.block.number + '-' + exIdx + '_ev' + evIdx,
      height: data.block.number.toNumber(),
      blockHash: data.block.hash.toString(),
      type: ex.method,
      subType: undefined,
      event: ev.method,
      timestamp: GetTime(data.block.extrinsics),
      specVersion: undefined,
      transactionVersion: undefined,
      authorId: undefined,
      senderId: ev.data[0].toString(),
      recipientId: ev.data[1].toString(),
      amount: BigInt(ev.data[2]),
      //      totalFee: undefined,
      partialFee: undefined,
      feeBalances: undefined,
      feeTreasury: undefined,
      tip: undefined,
      success: undefined
    };

    data.txs.push(tx);
  }
}

// --------------------------------------------------------------
// process missing events in older runtimes
async function ProcessMissingEvents(data: TBlockData, ex: IExtrinsic, exIdx: number, ev: ISanitizedEvent, evIdx: number, specVer: number): Promise<void> {

  // balances.Reserved/balances.Unreserved/balances.ReserveRepatriated are new from kusama v2008 / polkadot v8
  // for older runtimes we try to emulate the transfer
  const verReserve = {
    'Kusama': 2008,
    'Polkadot': 13
  }
  const checkResVer = verReserve[data.chain];
  if (!checkResVer || checkResVer <= specVer)  // higher specVersion, nothing to do
    return;

  if (ev.method == 'identity.JudgementRequested') {   // a trigger event for emulated balances.ReserveRepatriated

    const regIdx = ev.data[1];
    const registrars = await data.api.query.identity.registrars.at(data.block.hash);
    if (!registrars.length)
      return;
    const registrar = registrars[regIdx.toString()].unwrap();

    const tx: TTransaction = {
      chain: data.db.chain,
      id: data.block.number + '-' + exIdx + '_ev' + evIdx + '_1',
      height: data.block.number.toNumber(),
      blockHash: data.block.hash.toString(),
      type: ex.method,
      subType: undefined,
      event: 'balances.ReserveRepatriated_e',   // emulated
      timestamp: GetTime(data.block.extrinsics),
      specVersion: undefined,
      transactionVersion: undefined,
      authorId: undefined,
      senderId: ev.data[0].toString(),
      recipientId: registrar.account.toString(),
      amount: BigInt(registrar.fee),
      //      totalFee: undefined,
      partialFee: undefined,
      feeBalances: undefined,
      feeTreasury: undefined,
      tip: undefined,
      success: undefined
    };

    data.txs.push(tx);
  }
}

// --------------------------------------------------------------
// looks for balance.Deposit method with fee infomation and sets this in tx
// calculates totalFee as sum of feeBalances and feeTreasury
function CalcTotalFee(ex: IExtrinsic, tx: TTransaction): boolean {
  if (ex.paysFee)
    ex.events.forEach((ev: ISanitizedEvent) => {
      if (ev.method == 'balances.Deposit') {
        tx.feeBalances = BigInt(ev.data[1]);
      }
      else if (ev.method == 'treasury.Deposit') {
        tx.feeTreasury = BigInt(ev.data[0]);
      }
    });

  //  if (tx.feeBalances || tx.feeTreasury)
  //    tx.totalFee = (tx.feeBalances || BigInt(0)) + (tx.feeTreasury || BigInt(0));
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
      this._lastBlock = header.number.toNumber();

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

// --------------------------------------------------------------
// bigint devision with decimal result
export function Divide(a: bigint, b: bigint): number {
  const q = Number(BigInt(a) / BigInt(b));
  const r = Number(BigInt(a) % BigInt(b));
  return q + r / Number(b);
}

// --------------------------------------------------------------
// validates configFile according to the schema file
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ValidateConfigFile(config: any, schemaFile: string): any {
  const ajv = new Ajv({ allErrors: true });
  const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'));
  const validate = ajv.compile(schema);

  if (!validate(config))
    throw Error('Invalid structure of config.json: ' + ajv.errorsText(validate.errors));
  return config;
}

// --------------------------------------------------------------
// loads config.json and return config object
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function LoadConfigFile(): any {
  const configFile = './config/config.json';
  const configFile_tpl = './config/config_tpl.json'

  // first copy config from temlate, if not there
  if (!fs.existsSync(configFile))
    fs.copyFileSync(configFile_tpl, configFile);

  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  return ValidateConfigFile(config, './schema/config.schema.json');
}

