import { ApiPromise } from '@polkadot/api';
import { BlockHash, RuntimeVersion } from '@polkadot/types/interfaces';
import { IBlock, IChainData, IExtrinsic, ISanitizedEvent, IOnInitializeOrFinalize, IAccountBalanceInfo, IAccountStakingInfo } from './types';
import ApiHandler from './ApiHandler';
import { CTxDB, TTransaction } from './CTxDB';
import { CLogBlockNr } from "./CLogBlockNr";
import * as getPackageVersion from '@jsbits/get-package-version';
import { GetTime } from './utils';

export type TBlockData = {
  api: ApiPromise,
  handler: ApiHandler,
  blockNr: number,        // used before fetching the block 
  blockHash: BlockHash,   // used before fetching the block
  block: IBlock,
  db: CTxDB,
  txs: TTransaction[],
  chain: string,
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

    console.log(`polka-store: v${ver}`);
    console.log(`Chain:       ${chain}`);
    console.log(`Node:        ${nodeName} v${nodeVersion}`);
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
  async ScanChain(): Promise<void> {
    if (!this._api || !this._db)
      return;

    const maxBlock = this._db.GetMaxHeight();
    const header = await this._api.rpc.chain.getHeader();
    const LogBlock = new CLogBlockNr(this._api, Number(header.number));

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
      const data: TBlockData = {
        api: this._api,
        handler: this._apiHandler,
        block: <IBlock><unknown>0,
        blockHash: await this._api.rpc.chain.getBlockHash(blockNr),
        blockNr: blockNr,
        txs: [],
        db: this._db,
        chain: this._chain
      };
      await this.ProcessBlockDataH(data);
    }
    catch (e) {
      this._errors++;
      console.error('BlockNr: %d Error: %s\n------------------------------', blockNr, (e as Error).message);
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
      if (ev.method == 'staking.Slash') {

        const tx: TTransaction = {
          chain: data.db.chain,
          id: data.block.number + '_onInitialize_ev' + index,
          height: data.blockNr,
          blockHash: data.block.hash.toString(),
          type: ev.method,
          subType: undefined,
          event: ev.method,
          addData: undefined,
          timestamp: GetTime(data.block.extrinsics),
          specVersion: undefined,
          transactionVersion: undefined,
          authorId: data.block.authorId?.toString(),
          senderId: ev.data[0].toString(),
          recipientId: undefined,
          amount: BigInt(ev.data[1]),
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
          amount: -BigInt(ev.data[1]),
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
    /*
        const methodsToScan = [
          'utility.batch', 'utility.batch_all', 'utility.as_derivative',
          'proxy.proxy', 'multisig.asMulti',
          'staking.payoutStakers', 'staking.bond', 'staking.bondExtra', 'staking.unbond',
          'balances.transfer', 'balances.forceTransfer', 'balances.transferKeepAlive', 'vesting.vestedTransfer', 'vesting.forceVestedTransfer',
          'identity.requestJudgement' // for ProcessMissingEvents
        ];
    */
    const ver = await data.api.rpc.state.getRuntimeVersion(data.block.parentHash); // get runtime version of the block

    for (let exIdx = 0, n = data.block.extrinsics.length; exIdx < n; exIdx++) {
      const ex = data.block.extrinsics[exIdx];
      //const method = ex.method;

      // 1. process all signed transactions (stores the fee / tip)
      await this.ProcessGeneral(data, ex, exIdx, ver);

      // 2. process events attached to extrinsics
      //if (methodsToScan.includes(method))
      await Promise.all(ex.events.map(async (ev: ISanitizedEvent, evIdx: number) => {
        await this.ProcessEvents(data, ex, exIdx, ev, evIdx, ver.specVersion.toNumber());
      }));

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

    if (ex.signature) { // there is a signer

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
        senderId: ex.signature.signer.toString(),
        recipientId: undefined,
        amount: undefined,
        totalFee: undefined,
        feeBalances: undefined,
        feeTreasury: undefined,
        tip: BigInt(ex.tip),
        success: ex.success ? 1 : 0
      };

      this.CalcTotalFee(ex, tx); // calculate totalFee fee based on balances.Deposit and treasury.Deposit events

      data.txs.push(tx);
    }
  }

  // --------------------------------------------------------------
  // process all event
  private async ProcessEvents(data: TBlockData, ex: IExtrinsic, exIdx: number, ev: ISanitizedEvent, evIdx: number, specVer: number): Promise<void> {
    await Promise.all([
      this.ProcessTransferEvents(data, ex, exIdx, ev, evIdx),
      this.ProcesDustLostEvents(data, ex, exIdx, ev, evIdx),
      this.ProcessStakingRewardEvents(data, ex, exIdx, ev, evIdx),
      this.ProcessStakingBondedEvents(data, ex, exIdx, ev, evIdx),
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
        amount: BigInt(ev.data[2]),
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
        amount: BigInt(ev.data[1]),
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
  // process staking.Reward events
  private async ProcessStakingRewardEvents(data: TBlockData, ex: IExtrinsic, exIdx: number, ev: ISanitizedEvent, evIdx: number): Promise<void> {
    if (ev.method == 'staking.Reward') {

      const stashId = ev.data[0].toString();  // AcountID of validator
      if (!stashId || stashId == '0')         // invalid stashId
        return;

      let payee = stashId; // init payee

      // get reward destination from api
      const rd = await data.api.query.staking.payee.at(data.block.hash, stashId);
      if (rd.isAccount) // reward dest: an explicitely given account 
        payee = rd.asAccount.toString();
      else if (rd.isController) // reward dest: the controller account
        payee = (await data.api.query.staking.bonded.at(data.block.hash, stashId)).toString();

      const tx: TTransaction = {
        chain: data.db.chain,
        id: data.block.number + '-' + exIdx + '_ev' + evIdx,
        height: data.blockNr,
        blockHash: data.block.hash.toString(),
        type: ex.method,
        subType: undefined,
        event: ev.method,
        addData: stashId,
        timestamp: GetTime(data.block.extrinsics),
        specVersion: undefined,
        transactionVersion: undefined,
        authorId: undefined,
        senderId: undefined,
        recipientId: payee,
        amount: BigInt(ev.data[1]),
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
  // process staking.Bonded events
  private async ProcessStakingBondedEvents(data: TBlockData, ex: IExtrinsic, exIdx: number, ev: ISanitizedEvent, evIdx: number): Promise<void> {
    let method = ev.method;
    let event_suffix = '';

    // check if reward destination is staked
    if (method == 'staking.Reward') {
      const stashId = ev.data[0].toString();  // AcountID of validator
      if (!stashId || stashId == '0')         // invalid stashId
        return;

      const rd = await data.api.query.staking.payee.at(data.block.hash, stashId);
      if (rd.isStaked) {
        method = 'staking.Bonded';  // create a Bonded event
        event_suffix = '_1';        // id must be unique
      }
    }

    if (method == 'staking.Bonded') {

      const tx: TTransaction = {
        chain: data.db.chain,
        id: data.block.number + '-' + exIdx + '_ev' + evIdx + event_suffix,
        height: data.blockNr,
        blockHash: data.block.hash.toString(),
        type: ex.method,
        subType: undefined,
        event: method,
        addData: ev.data[0].toString(), // AcountID of validator,
        timestamp: GetTime(data.block.extrinsics),
        specVersion: undefined,
        transactionVersion: undefined,
        authorId: undefined,
        senderId: undefined,
        recipientId: undefined,
        amount: BigInt(ev.data[1]),
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
        amount: -BigInt(ev.data[1]),
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
        amount: BigInt(ev.data[2]),
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
  // process missing events in older runtimes
  private async ProcessMissingEvents(data: TBlockData, ex: IExtrinsic, exIdx: number, ev: ISanitizedEvent, evIdx: number, specVer: number): Promise<void> {

    // balances.Reserved/balances.Unreserved/balances.ReserveRepatriated are new from kusama v2008 / polkadot v8
    // for older runtimes we try to emulate the transfer
    const verReserve = {
      'Kusama': 2008,
      'Polkadot': 13
    };
    const checkResVer = verReserve[data.chain];
    if (!checkResVer || checkResVer <= specVer) // higher specVersion, nothing to do
      return;

    if (ev.method == 'identity.JudgementRequested') { // a trigger event for emulated balances.ReserveRepatriated

      const regIdx = ev.data[1];
      const registrars = await data.api.query.identity.registrars.at(data.block.hash);
      if (!registrars.length)
        return;
      const registrar = registrars[regIdx.toString()].unwrap();

      const tx: TTransaction = {
        chain: data.db.chain,
        id: data.block.number + '-' + exIdx + '_ev' + evIdx + '_1',
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
  // looks for balance.Deposit method with fee infomation and sets this in tx
  // calculates totalFee as sum of feeBalances and feeTreasury
  private CalcTotalFee(ex: IExtrinsic, tx: TTransaction): boolean {
    if (ex.paysFee)
      ex.events.forEach((ev: ISanitizedEvent) => {
        if (ev.method == 'balances.Deposit') {
          tx.feeBalances = BigInt(ev.data[1]);
        }
        else if (ev.method == 'treasury.Deposit') {
          tx.feeTreasury = BigInt(ev.data[0]);
        }
      });

    if (tx.feeBalances || tx.feeTreasury)
      tx.totalFee = (tx.feeBalances || BigInt(0)) + (tx.feeTreasury || BigInt(0));
    return !ex.paysFee || (tx.totalFee != undefined);
  }

}
