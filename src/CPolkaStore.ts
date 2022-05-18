import { ApiPromise } from '@polkadot/api';
import { ApiDecoration } from '@polkadot/api/types';
import { Compact, Option } from '@polkadot/types';
import { AssetId, BlockHash, RuntimeVersion, MultiLocationV0, MultiAssetV0, StakingLedger, BalanceOf, Outcome } from '@polkadot/types/interfaces';
import {
  IBlock, IChainData, IExtrinsic, ISanitizedEvent, IOnInitializeOrFinalize,
  IAccountBalanceInfo, IAccountStakingInfo, IAccountAssetsBalances, IAssetInfo
} from './types';
import ApiHandler from './ApiHandler';
import { CTxDB, TTransaction } from './CTxDB';
import { CLogBlockNr } from "./CLogBlockNr";
import * as getPackageVersion from '@jsbits/get-package-version';
import { GetTime, GetNodeVersion } from './utils';

export type TBlockData = {
  api: ApiPromise,
  apiAt: ApiDecoration<"promise">,
  handler: ApiHandler,
  blockNr: number,        // used before fetching the block 
  blockHash: BlockHash,   // used before fetching the block
  block: IBlock,
  db: CTxDB,
  txs: TTransaction[],
  chain: string,
  isRelayChain: boolean
};

export type TFee = {
  totalFee: bigint | undefined,
  feeBalances: bigint | undefined,
  feeTreasury: bigint | undefined
};

// --------------------------------------------------------------
// Main Class

export class CPolkaStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _chainData: IChainData;
  private _chain: string;
  private _api: ApiPromise;
  private _apiHandler: ApiHandler;
  private _db: CTxDB;
  private _errors: number;

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/no-explicit-any
  constructor(chainData: IChainData, chain: string) {
    this._chainData = chainData;
    this._chain = chain;
    this._errors = 0;
  }

  // --------------------------------------------------------------
  async InitAPI(): Promise<ApiPromise> {

    this._apiHandler = new ApiHandler(this._chainData.providers); // Create API Handler
    this._api = await this._apiHandler.connect();

    if (!this._api)
      process.exit(1);

    // Retrieve the chain & node information information via rpc calls
    const [chain, nodeName, nodeVersion] = await Promise.all([
      this._api.rpc.system.chain(),
      this._api.rpc.system.name(),
      this._api.rpc.system.version()
    ]);

    const ver = getPackageVersion();
    const nodeVer = GetNodeVersion();

    console.log();
    console.log(`polka-store: v${ver}`);
    console.log(`Chain:       ${chain}`);
    console.log(`Node:        ${nodeName} v${nodeVersion}`);
    console.log(`Node.js:     ${nodeVer.original}`);
    console.log(`Provider:    ${this._apiHandler.currentEndpoint}`);
    console.log(`API:         ${this._api.libraryInfo}\n`);

    if (chain.toString() != this._chain) {
      console.log('Wrong chain!\nGot "%s" chain, but expected "%s" chain.', chain.toString(), this._chain);
      console.log('Process aborted.\n');
      process.exit(1);
    }

    return this._api;
  }

  // --------------------------------------------------------------
  InitDataBase(chain: string, filename?: string): CTxDB {
    this._db = new CTxDB(chain, filename); // Create transaction database instance
    return this._db;
  }

  // --------------------------------------------------------------
  async LastBlock(): Promise<number> {
    const header = await this._api.rpc.chain.getHeader();
    return Number(header.number);
  }

  // --------------------------------------------------------------
  async ScanChain(): Promise<void> {
    if (!this._api || !this._db)
      return;

    const maxBlock = this._db.GetMaxHeight();
    const lastBlock = await this.LastBlock();
    const LogBlock = new CLogBlockNr(this._api, lastBlock);

    // scan the chain and write block data to database
    const start = Math.max(maxBlock, this._chainData.startBlock);
    for (let i = start; i <= LogBlock.LastBlock(); i++) {
      await this.ProcessBlockData(i);
      LogBlock.LogBlock(this._errors, i, i == LogBlock.LastBlock());
    }
    console.log('\n');  // final line break
  }

  // --------------------------------------------------------------
  async fetchBalance(blockNr: number, address: string): Promise<IAccountBalanceInfo> {
    const hash = await this._api.rpc.chain.getBlockHash(blockNr);
    return await this.fetchBalanceH(hash, address);
  }

  // --------------------------------------------------------------
  async fetchBalanceH(blockHash: BlockHash, address: string): Promise<IAccountBalanceInfo> {
    return await this._apiHandler.fetchBalance(blockHash, address);
  }

  // --------------------------------------------------------------
  async fetchAssetBalances(blockNr: number, address: string, assets: number[] | null = null): Promise<IAccountAssetsBalances> {
    const hash = await this._api.rpc.chain.getBlockHash(blockNr);
    return await this.fetchAssetBalancesH(hash, address, assets);
  }

  // --------------------------------------------------------------
  async fetchAssetBalancesH(blockHash: BlockHash, address: string, assets: number[] | null = null): Promise<IAccountAssetsBalances> {
    let assets1: number[] = [];
    if (assets)
      assets1 = assets;
    return await this._apiHandler.fetchAssetBalances(blockHash, address, assets1);
  }

  // --------------------------------------------------------------
  async fetchAssetById(blockNr: number, assetId: number | AssetId): Promise<IAssetInfo> {
    const hash = await this._api.rpc.chain.getBlockHash(blockNr);
    return await this.fetchAssetByIdH(hash, assetId);
  }

  // --------------------------------------------------------------
  async fetchAssetByIdH(blockHash: BlockHash, assetId: number | AssetId): Promise<IAssetInfo> {
    return await this._apiHandler.fetchAssetById(blockHash, assetId);
  }

  // --------------------------------------------------------------
  async fetchAllAssets(blockNr: number): Promise<IAssetInfo[]> {
    const hash = await this._api.rpc.chain.getBlockHash(blockNr);
    return await this.fetchAllAssetsH(hash);
  }

  // --------------------------------------------------------------
  async fetchAllAssetsH(blockHash: BlockHash): Promise<IAssetInfo[]> {
    return await this._apiHandler.fetchAllAssets(blockHash);
  }

  // --------------------------------------------------------------
  async fetchStakingInfo(blockNr: number, address: string): Promise<IAccountStakingInfo | null> {
    const hash = await this._api.rpc.chain.getBlockHash(blockNr);
    return await this.fetchStakingInfoH(hash, address);
  }

  // --------------------------------------------------------------
  async fetchStakingInfoH(blockHash: BlockHash, address: string): Promise<IAccountStakingInfo | null> {
    return await this._apiHandler.fetchStakingInfo(blockHash, address);
  }

  // --------------------------------------------------------------
  async fetchBlock(blockNr: number): Promise<IBlock> {
    const hash = await this._api.rpc.chain.getBlockHash(blockNr);
    return await this.fetchBlockH(hash);
  }

  // --------------------------------------------------------------
  async fetchBlockH(blockHash: BlockHash): Promise<IBlock> {
    return await this._apiHandler.fetchBlock(blockHash);
  }

  // --------------------------------------------------------------
  async ProcessBlockData(blockNr: number): Promise<void> {
    try {
      const hash = await this._api.rpc.chain.getBlockHash(blockNr);

      const data: TBlockData = {
        api: this._api,
        apiAt: await this._api.at(hash),
        handler: this._apiHandler,
        block: <IBlock><unknown>0,
        blockHash: hash,
        blockNr: blockNr,
        txs: [],
        db: this._db,
        chain: this._chain,
        isRelayChain: ["Polkadot", "Kusama", "Westend"].includes(this._chain)
      };
      await this.ProcessBlockDataH(data);
    }
    catch (e) {
      this.ErrorOutB(blockNr, (e as Error).message, true);
    }
  }

  // --------------------------------------------------------------
  private async ProcessBlockDataH(data: TBlockData): Promise<void> {
    data.block = await this.fetchBlockH(data.blockHash);
    await this.ProcessBlockDataE(data);
  }

  // --------------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  private async ProcessBlockDataE(data: TBlockData): Promise<void> {
    await Promise.all([
      this.ProcessStakingSlashEvents(data, data.block.onInitialize),
      this.ProcessExtrinsics(data) // 2. process extrinsics
    ]);

    data.db.InsertTransactions(data.txs);
  }

  // --------------------------------------------------------------
  // process block events
  private async ProcessStakingSlashEvents(data: TBlockData, onIF: IOnInitializeOrFinalize): Promise<void> {
    onIF.events.forEach((ev: ISanitizedEvent, index: number) => {
      if (ev.method == 'staking.Slash' || ev.method == 'staking.Slashed') {   // staking.Slashed from runtime 9090

        const tx: TTransaction = {
          chain: data.db.chain,
          id: data.block.number + '_onInitialize_ev' + index,
          height: data.blockNr,
          blockHash: data.block.hash.toString(),
          type: ev.method,
          subType: undefined,
          event: 'staking.Slashed',
          addData: undefined,
          timestamp: GetTime(data.block.extrinsics),
          specVersion: undefined,
          transactionVersion: undefined,
          authorId: data.block.authorId?.toString(),
          senderId: ev.data[0].toString(),
          recipientId: undefined,
          amount: BigInt(ev.data[1].toString()),
          totalFee: undefined,
          feeBalances: undefined,
          feeTreasury: undefined,
          tip: undefined,
          success: undefined
        };

        data.txs.push(tx);

        // emulate a staking.Unbonded event
        const tx1: TTransaction = {
          chain: tx.chain,
          id: tx.id + '_1',
          height: tx.height,
          blockHash: tx.blockHash,
          type: tx.type,
          subType: undefined,
          event: 'staking.Unbonded',
          addData: tx.senderId, // AcountID of validator,
          timestamp: tx.timestamp,
          specVersion: undefined,
          transactionVersion: undefined,
          authorId: undefined,
          senderId: undefined,
          recipientId: undefined,
          amount: -BigInt(ev.data[1].toString()),
          totalFee: undefined,
          feeBalances: undefined,
          feeTreasury: undefined,
          tip: undefined,
          success: undefined
        };

        data.txs.push(tx1);
      }
    });
  }

  // --------------------------------------------------------------
  // process general extrinsics
  private async ProcessExtrinsics(data: TBlockData): Promise<void> {
    const ver = await data.api.rpc.state.getRuntimeVersion(data.block.parentHash); // get runtime version of the block

    for (let exIdx = 0, n = data.block.extrinsics.length; exIdx < n; exIdx++) {
      const ex = data.block.extrinsics[exIdx];
      //const method = ex.method;

      // 1. process all signed transactions (stores the fee / tip)
      await this.ProcessGeneral(data, ex, exIdx, ver);

      // 2. process events attached to extrinsics
      //if (methodsToScan.includes(method))

      // blockwise processing to avoid memory overflow
      const events = ex.events.slice();   // create a copy
      let evIdxBase = 0;
      while (events.length) {    // only 100 events in parallel
        const e = events.slice(0, 100);
        events.splice(0, 100);
        await Promise.all(e.map(async (ev: ISanitizedEvent, evIdx: number) => {
          await this.ProcessEvents(data, ex, exIdx, ev, evIdxBase + evIdx, ver.specVersion.toNumber());
        }));
        evIdxBase += e.length;
      }
      /*
            await Promise.all(ex.events.map(async (ev: ISanitizedEvent, evIdx: number) => {
              await this.ProcessEvents(data, ex, exIdx, ev, evIdx, ver.specVersion.toNumber());
            }));
      */
      // sequential:
      /*
      if (methodsToScan.includes(method))
        for (let i = 0, n = ex.events.length; i < n; i++)
          await this.ProcessEvents(data, ex, exIdx, ex.events[i], i, ver.specVersion.toNumber());
      */
    }
  }

  // --------------------------------------------------------------
  // process general extrinsics
  private async ProcessGeneral(data: TBlockData, ex: IExtrinsic, idxEx: number, ver: RuntimeVersion): Promise<void> {

    //const pf = (<RuntimeDispatchInfo>ex.info).partialFee;
    let subType: string | undefined = undefined;
    const method = ex.method;
    if (method == 'proxy.proxy' || method == 'utility.batch') {
      if (ex.args.call) {
        subType = ex.args.call.method;
      }
      else if (ex.args.calls) {
        const arr: string[] = [];
        ex.args.calls.forEach(arg => {
          if (!arr.includes(arg.method))
            arr.push(arg.method);
        });
        subType = arr.join();
      }
    }

    const tx: TTransaction = {
      chain: data.db.chain,
      id: data.block.number + '-' + idxEx,
      height: data.blockNr,
      blockHash: data.block.hash.toString(),
      type: method,
      subType: subType,
      event: undefined,
      addData: undefined,
      timestamp: GetTime(data.block.extrinsics),
      specVersion: ver.specVersion.toNumber(),
      transactionVersion: ver.transactionVersion.toNumber(),
      authorId: data.block.authorId?.toString(),
      senderId: ex.signature?.signer.toString(),
      recipientId: undefined,
      amount: undefined,
      totalFee: undefined,
      feeBalances: undefined,
      feeTreasury: undefined,
      tip: ex.tip?.toBigInt(),
      success: ex.success ? 1 : 0
    };

    this.CalcTotalFee(data, ex, tx); // calculate totalFee fee based on balances.Deposit and treasury.Deposit events

    //fees come from the relay chain (signed ex), but can also come from validating the parachains
    if (ex.signature || tx.totalFee)
      data.txs.push(tx);
  }

  // --------------------------------------------------------------
  // process all event
  private async ProcessEvents(data: TBlockData, ex: IExtrinsic, exIdx: number, ev: ISanitizedEvent, evIdx: number, specVer: number): Promise<void> {
    await Promise.all([
      this.ProcessTransferEvents(data, ex, exIdx, ev, evIdx),
      this.ProcessClaimEvents(data, ex, exIdx, ev, evIdx),
      this.ProcesDustLostEvents(data, ex, exIdx, ev, evIdx),
      this.ProcessStakingRewardEvents(data, ex, exIdx, ev, evIdx),
      this.ProcessStakingBondedEvents(data, ex, exIdx, ev, evIdx, specVer),
      this.ProcessStakingUnbondedEvents(data, ex, exIdx, ev, evIdx),
      this.ProcessReserveRepatriatedEvents(data, ex, exIdx, ev, evIdx),
      this.ProcessMissingEvents(data, ex, exIdx, ev, evIdx, specVer)
    ]);
  }

  // --------------------------------------------------------------
  // process transfer events
  private async ProcessTransferEvents(data: TBlockData, ex: IExtrinsic, exIdx: number, ev: ISanitizedEvent, evIdx: number): Promise<void> {
    if (ev.method == 'balances.Transfer') {

      const tx: TTransaction = {
        chain: data.db.chain,
        id: data.block.number + '-' + exIdx + '_ev' + evIdx,
        height: data.blockNr,
        blockHash: data.block.hash.toString(),
        type: ex.method,
        subType: undefined,
        event: ev.method,
        addData: undefined,
        timestamp: GetTime(data.block.extrinsics),
        specVersion: undefined,
        transactionVersion: undefined,
        authorId: undefined,
        senderId: ev.data[0].toString(),
        recipientId: ev.data[1].toString(),
        amount: BigInt(ev.data[2].toString()),
        totalFee: ev.data.length == 4 ? BigInt(ev.data[3].toString()) : undefined,  // optional 4th element is fee (kusama runtime <1050 only) 
        feeBalances: undefined,
        feeTreasury: undefined,
        tip: undefined,
        success: undefined
      };

      if (!tx.amount || this.IsValidBigint(tx.amount, tx.id))
        data.txs.push(tx);
    }
  }

  // --------------------------------------------------------------
  // process claim events
  private async ProcessClaimEvents(data: TBlockData, ex: IExtrinsic, exIdx: number, ev: ISanitizedEvent, evIdx: number): Promise<void> {
    if (ev.method == 'claims.Claimed') {

      const tx: TTransaction = {
        chain: data.db.chain,
        id: data.block.number + '-' + exIdx + '_ev' + evIdx,
        height: data.blockNr,
        blockHash: data.block.hash.toString(),
        type: ex.method,
        subType: undefined,
        event: ev.method,
        addData: ev.data[1].toString(),           // EthereumAddress
        timestamp: GetTime(data.block.extrinsics),
        specVersion: undefined,
        transactionVersion: undefined,
        authorId: undefined,
        senderId: undefined,
        recipientId: ev.data[0].toString(),       // AccountId
        amount: BigInt(ev.data[2].toString()),    // Balance
        totalFee: undefined,
        feeBalances: undefined,
        feeTreasury: undefined,
        tip: undefined,
        success: undefined
      };

      if (!tx.amount || this.IsValidBigint(tx.amount, tx.id))
        data.txs.push(tx);
    }
  }

  // --------------------------------------------------------------
  // process transfer events
  private async ProcesDustLostEvents(data: TBlockData, ex: IExtrinsic, exIdx: number, ev: ISanitizedEvent, evIdx: number): Promise<void> {
    if (ev.method == 'balances.DustLost') {

      const tx: TTransaction = {
        chain: data.db.chain,
        id: data.block.number + '-' + exIdx + '_ev' + evIdx,
        height: data.blockNr,
        blockHash: data.block.hash.toString(),
        type: ex.method,
        subType: undefined,
        event: ev.method,
        addData: undefined,
        timestamp: GetTime(data.block.extrinsics),
        specVersion: undefined,
        transactionVersion: undefined,
        authorId: undefined,
        senderId: ev.data[0].toString(),
        recipientId: undefined,
        amount: BigInt(ev.data[1].toString()),
        totalFee: undefined,
        feeBalances: undefined,
        feeTreasury: undefined,
        tip: undefined,
        success: undefined
      };

      if (!tx.amount || this.IsValidBigint(tx.amount, tx.id))
        data.txs.push(tx);
    }
  }

  // --------------------------------------------------------------
  // process staking.Rewarded events
  private async ProcessStakingRewardEvents(data: TBlockData, ex: IExtrinsic, exIdx: number, ev: ISanitizedEvent, evIdx: number): Promise<void> {
    if (ev.method == 'staking.Reward' || ev.method == 'staking.Rewarded') {   // staking.Rewarded from runtime 9090
      if (ev.data[0].toRawType() != 'AccountId')                    // before Runtime 1050 in Kusama: type 'Balance'
        return;
      const stashId = ev.data[0].toString();                      // AccountID of validator
      if (!this.IsValidAccountID(data.blockNr, exIdx, stashId))   // invalid stashId
        return;

      let payee = stashId; // init payee

      // get reward destination from api
      const rd = await data.apiAt.query.staking.payee(stashId);
      if (rd.isAccount) // reward dest: an explicitely given account 
        payee = rd.asAccount.toString();
      else if (rd.isController) // reward dest: the controller account
        payee = (await data.apiAt.query.staking.bonded(stashId)).toString();

      const tx: TTransaction = {
        chain: data.db.chain,
        id: data.block.number + '-' + exIdx + '_ev' + evIdx,
        height: data.blockNr,
        blockHash: data.block.hash.toString(),
        type: ex.method,
        subType: undefined,
        event: 'staking.Rewarded',
        addData: stashId,
        timestamp: GetTime(data.block.extrinsics),
        specVersion: undefined,
        transactionVersion: undefined,
        authorId: undefined,
        senderId: undefined,
        recipientId: payee,
        amount: BigInt(ev.data[1].toString()),
        totalFee: undefined,
        feeBalances: undefined,
        feeTreasury: undefined,
        tip: undefined,
        success: undefined
      };

      if (!tx.amount || this.IsValidBigint(tx.amount, tx.id))
        data.txs.push(tx);
    }
  }

  // --------------------------------------------------------------
  // process staking.Bonded events
  private async ProcessStakingBondedEvents(data: TBlockData, ex: IExtrinsic, exIdx: number, ev: ISanitizedEvent, evIdx: number, specVer: number): Promise<void> {
    let method = ev.method;
    let event_suffix = '';

    // check if reward destination is staked
    if (method == 'staking.Reward' || method == 'staking.Rewarded') {   // staking.Rewarded from runtime 9090
      if (ev.data[0].toRawType() != 'AccountId')                    // before Runtime 1050 in Kusama: type 'Balance'
        return;
      const stashId = ev.data[0].toString();                      // AccountId of validator
      if (!this.IsValidAccountID(data.blockNr, exIdx, stashId))   // invalid stashId
        return;

      const rd = await data.apiAt.query.staking.payee(stashId);
      if (rd.isStaked) {
        method = 'staking.Bonded';  // create a Bonded event
        event_suffix = '_1';        // id must be unique
      }
    }

    if (method == 'staking.Bonded') {
      const stash = ev.data[0].toString();
      const amount = await this.RepairStakingRebond(data, ex, BigInt(ev.data[1].toString()), data.blockNr, stash, specVer);  // repair amount for runtime <9100

      const tx: TTransaction = {
        chain: data.db.chain,
        id: data.block.number + '-' + exIdx + '_ev' + evIdx + event_suffix,
        height: data.blockNr,
        blockHash: data.block.hash.toString(),
        type: ex.method,
        subType: undefined,
        event: method,
        addData: stash, // AcountID of validator,
        timestamp: GetTime(data.block.extrinsics),
        specVersion: undefined,
        transactionVersion: undefined,
        authorId: undefined,
        senderId: undefined,
        recipientId: undefined,
        amount: amount,
        totalFee: undefined,
        feeBalances: undefined,
        feeTreasury: undefined,
        tip: undefined,
        success: undefined
      };

      if (!tx.amount || this.IsValidBigint(tx.amount, tx.id))
        data.txs.push(tx);
    }
  }

  // --------------------------------------------------------------
  // process staking.Unbonded events
  private async ProcessStakingUnbondedEvents(data: TBlockData, ex: IExtrinsic, exIdx: number, ev: ISanitizedEvent, evIdx: number): Promise<void> {
    if (ev.method == 'staking.Unbonded') {

      const tx: TTransaction = {
        chain: data.db.chain,
        id: data.block.number + '-' + exIdx + '_ev' + evIdx,
        height: data.blockNr,
        blockHash: data.block.hash.toString(),
        type: ex.method,
        subType: undefined,
        event: ev.method,
        addData: ev.data[0].toString(), // AcountID of validator,
        timestamp: GetTime(data.block.extrinsics),
        specVersion: undefined,
        transactionVersion: undefined,
        authorId: undefined,
        senderId: undefined,
        recipientId: undefined,
        amount: -BigInt(ev.data[1].toString()),
        totalFee: undefined,
        feeBalances: undefined,
        feeTreasury: undefined,
        tip: undefined,
        success: undefined
      };

      if (!tx.amount || this.IsValidBigint(tx.amount, tx.id))
        data.txs.push(tx);
    }
  }

  // --------------------------------------------------------------
  // process balance.ReserveRepatriated events (use reserved funds)
  private async ProcessReserveRepatriatedEvents(data: TBlockData, ex: IExtrinsic, exIdx: number, ev: ISanitizedEvent, evIdx: number): Promise<void> {
    if (ev.method == 'balances.ReserveRepatriated') {

      const tx: TTransaction = {
        chain: data.db.chain,
        id: data.block.number + '-' + exIdx + '_ev' + evIdx,
        height: data.blockNr,
        blockHash: data.block.hash.toString(),
        type: ex.method,
        subType: undefined,
        event: ev.method,
        addData: undefined,
        timestamp: GetTime(data.block.extrinsics),
        specVersion: undefined,
        transactionVersion: undefined,
        authorId: undefined,
        senderId: ev.data[0].toString(),
        recipientId: ev.data[1].toString(),
        amount: BigInt(ev.data[2].toString()),
        totalFee: undefined,
        feeBalances: undefined,
        feeTreasury: undefined,
        tip: undefined,
        success: undefined
      };

      if (!tx.amount || this.IsValidBigint(tx.amount, tx.id))
        data.txs.push(tx);
    }
  }

  // --------------------------------------------------------------
  // process missing events in older runtimes
  private async ProcessMissingEvents(data: TBlockData, ex: IExtrinsic, exIdx: number, ev: ISanitizedEvent, evIdx: number, specVer: number): Promise<void> {
    await Promise.all([
      this.ProcessMissingReserveRepatriated(data, ex, exIdx, ev, evIdx, specVer),
      this.ProcessMissingToParachainTransfer(data, ex, exIdx, ev, evIdx, specVer),
      this.ProcessMissingFromParachainTransfer(data, ex, exIdx, ev, evIdx, specVer),
      this.ProcessMissingStakingRebond(data, ex, exIdx, ev, evIdx, specVer)
    ]);
  }

  // --------------------------------------------------------------
  // process missing events for inter chain transfers
  private async ProcessMissingToParachainTransfer(data: TBlockData, ex: IExtrinsic, exIdx: number, ev: ISanitizedEvent, evIdx: number, specVer: number): Promise<void> {

    if (!data.isRelayChain ||
      specVer < 9010 ||
      !ex.signature ||      // we need a signer as sender
      !ex.success ||
      (ex.method != 'xcmPallet.reserveTransferAssets' && ex.method != 'xcmPallet.teleportAssets'))
      return;

    if (ev.method != 'xcmPallet.Attempted') // a trigger event for emulated events
      return;

    const o = ev.data[0] as Outcome;
    if (!o.isComplete)
      return;

    const dest = ex.args.dest as MultiLocationV0;
    const beneficiary = ex.args.beneficiary as MultiLocationV0;
    const assets = ex.args.assets as MultiAssetV0[];
    if (!dest.isX1 && !dest.isX2)
      return;

    if (!beneficiary.isX1 && !beneficiary.isX2)
      return;

    const destX1 = dest.isX1 ? dest.asX1 : dest.asX2[1];
    const beneficiaryX1 = beneficiary.isX1 ? beneficiary.asX1 : beneficiary.asX2[1];

    if (!destX1.isParachain)
      return;
    if (!beneficiaryX1.isAccountId32)
      return;

    const parachain = destX1.asParachain.toString();
    const net = beneficiaryX1.asAccountId32.network.toString();
    const account = beneficiaryX1.asAccountId32.id.toString();

    for (let i = 0; i < assets.length; i++) {
      if (!assets[i].isConcreteFungible) {
        continue;
      }
      const a = assets[i].asConcreteFungible;
      //      if (!a.id.isNull)
      //        continue;

      const tx: TTransaction = {
        chain: data.db.chain,
        id: data.block.number + '-' + exIdx + '_TransferParachain' + (i + 1),
        height: data.blockNr,
        blockHash: data.block.hash.toString(),
        type: ex.method,
        subType: undefined,
        event: 'balances.TransferParachain',    // 'synthetic event', not really existing
        addData: undefined,
        timestamp: GetTime(data.block.extrinsics),
        specVersion: undefined,
        transactionVersion: undefined,
        authorId: undefined,
        senderId: ex.signature.signer.toString(),
        recipientId: 'P' + parachain + ' ' + net + ':' + account,
        amount: a.amount.toBigInt(),
        totalFee: undefined,
        feeBalances: undefined,
        feeTreasury: undefined,
        tip: undefined,
        success: undefined
      };

      data.txs.push(tx);
    }
  }

  // --------------------------------------------------------------
  // process missing events for inter chain transfers
  private async ProcessMissingFromParachainTransfer(data: TBlockData, ex: IExtrinsic, exIdx: number, ev: ISanitizedEvent, evIdx: number, specVer: number): Promise<void> {

    if (!data.isRelayChain ||
      specVer < 9090 ||   // parachains starting with runtime 9090 in kusama / westend
      ex.signature ||     // transfers from parachain must not have a signer
      !ex.success ||
      (ex.method != 'paraInherent.enter'))
      return;

    if (ev.method != 'balances.Withdraw') // a trigger event for emulated events
      return;

    const senderId = ev.data[0].toString();
    const authorId = data.block.authorId?.toString();

    //    ex.events.forEach((ev: ISanitizedEvent, idx: number) => {
    for (let i = evIdx + 1, n = ex.events.length; i < n; i++) {

      const ev = ex.events[i];

      if (ev.method == 'ump.ExecutedUpward')    // end of current block
        break;

      if (ev.method == 'balances.Deposit' && ev.data[0].toString() != authorId) {  // ignore the fee for block author

        const tx: TTransaction = {
          chain: data.db.chain,
          id: data.block.number + '-' + exIdx + '_TransferFromParachain' + (i + 1),
          height: data.blockNr,
          blockHash: data.block.hash.toString(),
          type: ex.method,
          subType: undefined,
          event: 'balances.TransferFromParachain',    // 'synthetic event', not really existing
          addData: undefined,
          timestamp: GetTime(data.block.extrinsics),
          specVersion: undefined,
          transactionVersion: undefined,
          authorId: undefined,
          senderId: senderId,
          recipientId: ev.data[0].toString(),
          amount: BigInt(ev.data[1].toString()),
          totalFee: undefined,
          feeBalances: undefined,
          feeTreasury: undefined,
          tip: undefined,
          success: undefined
        };

        data.txs.push(tx);
      }
    }
  }

  // --------------------------------------------------------------
  // process missing events staking.rebond
  private async ProcessMissingStakingRebond(data: TBlockData, ex: IExtrinsic, exIdx: number, ev: ISanitizedEvent, evIdx: number, specVer: number): Promise<void> {

    if (!data.isRelayChain || 9050 <= specVer) // from specVer 9050 nothing to do
      return;

    if (!ex.signature ||  // we need a signer as sender
      evIdx ||            // only once per extrinsic
      !ex.success ||
      ex.method != 'staking.rebond')
      return;

    // the signer is the controller, we need the stash account
    const account = ex.signature.signer.toString();
    const stakingLedgerOption = await data.apiAt.query.staking.ledger(account) as Option<StakingLedger>;
    const stakingLedger = stakingLedgerOption.unwrapOr(null);
    if (!stakingLedger)
      return;

    const stash = stakingLedger.stash.toString();
    const value = ex.args.value as Compact<BalanceOf>;
    const amount = await this.RepairStakingRebond(data, ex, value.toBigInt(), data.blockNr, stash, specVer);  // repair amount for runtime <9100

    const tx: TTransaction = {
      chain: data.db.chain,
      id: data.block.number + '-' + exIdx + '_StakingRebond',
      height: data.blockNr,
      blockHash: data.block.hash.toString(),
      type: ex.method,
      subType: undefined,
      event: 'staking.Bonded',
      addData: stash,
      timestamp: GetTime(data.block.extrinsics),
      specVersion: undefined,
      transactionVersion: undefined,
      authorId: undefined,
      senderId: undefined,
      recipientId: undefined,
      amount: amount,
      totalFee: undefined,
      feeBalances: undefined,
      feeTreasury: undefined,
      tip: undefined,
      success: undefined
    };

    if (this.IsValidBigint(amount, tx.id))   // ignore invalid values (e.g. Block #4100283 polkadot)
      data.txs.push(tx);
  }

  // --------------------------------------------------------------
  // process missing balances.ReserveRepatriated event
  private async ProcessMissingReserveRepatriated(data: TBlockData, ex: IExtrinsic, exIdx: number, ev: ISanitizedEvent, evIdx: number, specVer: number): Promise<void> {

    if (!data.isRelayChain)
      return;

    // balances.Reserved/balances.Unreserved/balances.ReserveRepatriated are new from kusama v2008 / polkadot v13
    // for older runtimes we try to emulate the transfer
    const verReserve = {
      'Kusama': 2008,
      'Polkadot': 13
    };
    const checkResVer = verReserve[data.chain];
    if (!checkResVer || checkResVer <= specVer) // higher specVersion, nothing to do
      return;

    //    if (ev.method == 'identity.JudgementRequested') { // a trigger event for emulated balances.ReserveRepatriated
    if (ev.method == 'identity.JudgementGiven') { // a trigger event for emulated balances.ReserveRepatriated

      const regIdx = ev.data[1];
      const registrars = await data.apiAt.query.identity.registrars();
      if (!registrars.length)
        return;
      const registrar = registrars[regIdx.toString()].unwrap();

      const tx: TTransaction = {
        chain: data.db.chain,
        id: data.block.number + '-' + exIdx + '_ev' + evIdx + '_ReserveRepatriated',
        height: data.blockNr,
        blockHash: data.block.hash.toString(),
        type: ex.method,
        subType: undefined,
        event: 'balances.ReserveRepatriated_e',
        addData: undefined,
        timestamp: GetTime(data.block.extrinsics),
        specVersion: undefined,
        transactionVersion: undefined,
        authorId: undefined,
        senderId: ev.data[0].toString(),
        recipientId: registrar.account.toString(),
        amount: BigInt(registrar.fee),
        totalFee: undefined,
        feeBalances: undefined,
        feeTreasury: undefined,
        tip: undefined,
        success: undefined
      };

      data.txs.push(tx);
    }
  }

  // --------------------------------------------------------------
  // calculates totalFee, feeBalances and feeTreasury
  private CalcTotalFee(data: TBlockData, ex: IExtrinsic, tx: TTransaction): boolean {
    if (!ex.paysFee)
      return true;

    if (!data.isRelayChain || !tx.specVersion)
      return false;

    // filter events: determine only those that are necessary for the fee calculation
    const events = this.FilterEvents(ex, tx);
    if (!events.length)
      return false;

    const fee_old = this.CalcTotalFee_pre9120(events, tx);    // sum of feeBalances and feeTreasury
    let fee = fee_old;

    if (tx.specVersion >= 9120) {
      const fee_new = this.CalcTotalFee_9120(events, tx);     // consider balances.Withdraw

      if (fee_new.totalFee)                                   // use only, if successfull
        fee = fee_new;

      // Error Check
      if (fee_old.totalFee && fee_old.totalFee != fee.totalFee)
        this.ErrorOutEx(tx.id, 'old: total fee: ' + fee_old.totalFee + ' new total fee: ' + fee_new.totalFee, false, true);
    }

    tx.totalFee = fee.totalFee;
    tx.feeBalances = fee.feeBalances;
    tx.feeTreasury = fee.feeTreasury;

    return tx.totalFee != undefined;
  }

  // --------------------------------------------------------------
  // looks for balance.Deposit method with fee infomation and sets this in tx
  // calculates totalFee as sum of feeBalances and feeTreasury
  // the feeBalances goes to the block author, feeTreasury to the treasury
  private CalcTotalFee_pre9120(events: ISanitizedEvent[], tx: TTransaction): TFee {
    const ret: TFee = {
      totalFee: undefined,
      feeBalances: undefined,
      feeTreasury: undefined
    };

    events.forEach((ev: ISanitizedEvent) => {
      if (ev.method == 'balances.Deposit' && ev.data[0].toString() == tx.authorId) {  // calc fees for block author
        ret.feeBalances = (ret.feeBalances || BigInt(0)) + BigInt(ev.data[1].toString());
      }
      else if (ev.method == 'treasury.Deposit') {
        ret.feeTreasury = (ret.feeTreasury || BigInt(0)) + BigInt(ev.data[0].toString());
      }
    });

    if (ret.feeBalances || ret.feeTreasury)
      ret.totalFee = (ret.feeBalances || BigInt(0)) + (ret.feeTreasury || BigInt(0));
    return ret;
  }

  // --------------------------------------------------------------
  // starting with runtime 9120 there is a balances.Withdraw event containing the total fee
  private CalcTotalFee_9120(events: ISanitizedEvent[], tx: TTransaction): TFee {
    const ret: TFee = {
      totalFee: undefined,
      feeBalances: undefined,
      feeTreasury: undefined
    };

    const myBlock = tx.senderId == tx.authorId; // a special condition

    events.forEach((ev: ISanitizedEvent) => {
      // the fee payment of the sender (initial fee):
      if (ev.method == 'balances.Withdraw' && ev.data[0].toString() == tx.senderId) {
        if (!ret.totalFee)  // first balances.Withdraw only
          ret.totalFee = BigInt(ev.data[1].toString());
      }
      // maybe there is a refund to the sender because the final fee is lower than the initial fee:
      else if (!myBlock && ev.method == 'balances.Deposit' && ev.data[0].toString() == tx.senderId && ret.totalFee) {
        const v = BigInt(ev.data[1].toString());
        if (v <= ret.totalFee)
          ret.totalFee -= v;
      }
      // fee part going to Treasury:
      else if (ev.method == 'treasury.Deposit') {
        ret.feeTreasury = BigInt(ev.data[0].toString());
      }
    });

    if (ret.totalFee)
      ret.feeBalances = ret.totalFee - (ret.feeTreasury || BigInt(0));
    return ret;
  }

  // --------------------------------------------------------------
  // filter all events according to necessity for the fee calculation
  // needed: balances.Withdraw, balances.Deposit, treasury.Deposit
  // additionally filter uot needed balances.Deposit events:
  // 1. 'balances.Deposit' events which are related to an "staking.Rewarded" event
  // 2. duplicate 'balances.Deposit' events (runtime 9120...9130 only)
  private FilterEvents(ex: IExtrinsic, tx: TTransaction): ISanitizedEvent[] {
    const ret: ISanitizedEvent[] = [];

    let last: ISanitizedEvent | undefined;
    ex.events.forEach((ev: ISanitizedEvent) => {
      if (ev.method == 'balances.Withdraw' || ev.method == 'treasury.Deposit') {
        ret.push(last = ev);
        return;
      }

      // case 1: 'balances.Deposit' events which are related to an "staking.Rewarded" event
      if (ev.method == 'staking.Rewarded') {
        if (last && last.method == 'balances.Deposit' && ev.data[1].toString() == last.data[1].toString()) {
          ret.pop();
          last = undefined;
        }
        return;
      }

      // case 2: duplicate 'balances.Deposit' events
      if (ev.method == 'balances.Deposit') {
        if (tx.specVersion && tx.specVersion >= 9120 && tx.specVersion < 9130 &&
          last && last.method == 'balances.Deposit' && ev.data[1].toString() == last.data[1].toString())
          return;
        else
          ret.push(last = ev);
      }
    });
    return ret;
  }

  // --------------------------------------------------------------
  // checks, if accountId is valid
  private IsValidAccountID(blockNr: number, exIdx: number, accountId: string): boolean {
    const len = accountId.length;
    const ok = (len >= 46 && len <= 48);    // account length: kusama:47, polkadot:46-48, westend:48
    if (!ok)
      this.ErrorOutEx(blockNr + '-' + exIdx, 'Invalid accountId: ' + accountId + ' (length:' + accountId.length + ')', false);
    return ok;
  }

  // --------------------------------------------------------------
  // checks, if b is a valid bigint
  // writes error to stderr, if extrinsicId!=''
  private IsValidBigint(b: bigint, extrinsicId = ''): boolean {
    const biMax = BigInt('0x7fffffffffffffff'); // max. bigint
    const ok = (b >= -biMax) && (b <= biMax);
    if (!ok && extrinsicId != '') {
      this.ErrorOutEx(extrinsicId, 'Invalid bigint value: ' + b.toString(), false);
    }
    return ok;
  }

  // --------------------------------------------------------------
  // checks for runtime <=9111 the amount of staking.Bonded event following a staking.Rebond extrinsic 
  // background: up to runtime 9111 the staking.Bonded event after a staking.rebond ex. has not checked the available balance
  // e.g. Staking.Rebond amount: 1000 KSM, available KSM: 100, staking.Bonded amount: 1000 KSM (should be max. 100)
  private async RepairStakingRebond(data: TBlockData, ex: IExtrinsic, amount: bigint, blockNr: number, stash: string, specVer: number): Promise<bigint> {
    if (!data.isRelayChain || specVer > 9111 || ex.method != 'staking.rebond')
      return amount;

    const si = await this.fetchStakingInfo(blockNr, stash);
    const siPrev = await this.fetchStakingInfo(blockNr - 1, stash);
    const val = si ? si.staking.active.toBigInt() : BigInt(0);
    const valPrev = siPrev ? siPrev.staking.active.toBigInt() : BigInt(0);
    const amount2 = val - valPrev;

    if (amount2 >= amount)  // amount2 (calculated diff) can be greater because of an additional staking.bondExtra event (e.g. Polkadot Block 1693296)
      return amount;

    this.ErrorOutB(blockNr, '\'Staking.Rebond\' with wrong \'staking.Bonded\' event. Rebond:' + amount + ', Actually Bonded:' + amount2, false, false);
    return amount2;
  }

  // --------------------------------------------------------------
  // write Error (Block) to stderr
  private ErrorOutB(blockNr: number, msg: string, separator: boolean, isError = true): void {
    if (isError)
      this._errors++;
    console.error('BlockNr: %d Error: %s%s', blockNr, msg, separator ? '\n------------------------------' : '');
  }

  // --------------------------------------------------------------
  // write Error (Extrinsic) to stderr
  private ErrorOutEx(extrinsicId: string, msg: string, separator: boolean, isError = true): void {
    if (isError)
      this._errors++;
    console.error('Extrinsic: %s Error: %s%s', extrinsicId, msg, separator ? '\n------------------------------' : '');
  }

}
