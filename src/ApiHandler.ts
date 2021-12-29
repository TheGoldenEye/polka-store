import { ApiPromise, WsProvider } from '@polkadot/api';
import { Struct } from '@polkadot/types';
import { GenericCall } from '@polkadot/types/generic';
import { Codec, Registry } from '@polkadot/types/types';
import { BlockHash } from '@polkadot/types/interfaces/chain';
import { u8aToHex } from '@polkadot/util';
import { blake2AsU8a } from '@polkadot/util-crypto';
import { Balance, Index } from '@polkadot/types/interfaces';

import { IAccountBalanceInfo, IAccountStakingInfo, IBlock, ISanitizedCall, ISanitizedEvent } from './types';

export default class ApiHandler {
  private _endpoints: string[];
  private _currentEndpoint: string;
  private _api: ApiPromise;

  // --------------------------------------------------------------
  constructor(endpoints: string[]) {
    this._endpoints = endpoints;
    this._currentEndpoint = "";
  }

  // --------------------------------------------------------------
  get currentEndpoint(): string {
    return this._currentEndpoint;
  }

  // --------------------------------------------------------------
  async connect(): Promise<ApiPromise> {

    if (this._api?.isConnected)
      return this._api;

    // Find suitable API provider
    this._currentEndpoint = "";
    for (let i = 0, n = this._endpoints.length; i < n && !this._api?.isConnected; i++) {
      try {
        this._currentEndpoint = this._endpoints[i];
        const provider = new WsProvider(this._currentEndpoint, 1000);

        console.log('Connecting ', this._currentEndpoint, ' ...');

        // Create the API and check if ready
        this._api = new ApiPromise({ provider });
        await this._api.isReadyOrError;
      }
      catch (e) {
        if (this._api?.isConnected)
          await this._api?.disconnect();
      }
    }

    if (!this._api?.isConnected)
      throw ('Cannot find suitable endpoint to connect');

    this._api.on('error', (e) => {
      console.error(e);
    });

    return this._api;
  }

  // --------------------------------------------------------------
  async fetchBlock(hash: BlockHash): Promise<IBlock> {
    const apiAt = await this._api.at(hash);

    const [{ block }, header, events] = await Promise.all([
      this._api.rpc.chain.getBlock(hash),
      this._api.derive.chain.getHeader(hash),
      apiAt.query.system.events(),
    ]);

    const { parentHash, number, stateRoot, extrinsicsRoot } = block.header;
    const onInitialize = { events: [] as ISanitizedEvent[] };
    const onFinalize = { events: [] as ISanitizedEvent[] };

    const authorId = header?.author;

    const logs = block.header.digest.logs.map((log) => {
      const { type, index, value } = log;

      return { type, index, value };
    });

    const defaultSuccess = typeof events === 'string' ? events : false;
    const extrinsics = block.extrinsics.map((extrinsic) => {
      const {
        method,
        nonce,
        signature,
        signer,
        isSigned,
        tip,
      } = extrinsic;
      const hash = u8aToHex(blake2AsU8a(extrinsic.toU8a(), 256));
      const call = apiAt.registry.createType('Call', method);

      return {
        method: `${method.section}.${method.method}`,
        signature: isSigned ? { signature, signer } : null,
        nonce,
        args: this.parseGenericCall(call, apiAt.registry).args,
        tip,
        hash,
        info: {},
        events: [] as ISanitizedEvent[],
        success: defaultSuccess,
        // paysFee overrides to bool if `system.ExtrinsicSuccess|ExtrinsicFailed` event is present
        paysFee: null as null | boolean,
      };
    });

    const successEvent = 'system.ExtrinsicSuccess';
    const failureEvent = 'system.ExtrinsicFailed';

    if (Array.isArray(events)) {
      for (const record of events) {
        const { event, phase } = record;
        const sanitizedEvent = {
          method: `${event.section}.${event.method}`,
          data: event.data,
        };

        if (phase.isApplyExtrinsic) {
          const extrinsicIdx = phase.asApplyExtrinsic.toNumber();
          const extrinsic = extrinsics[extrinsicIdx];

          if (!extrinsic) {
            console.error(`Block ${block.header.number.toNumber()} ${hash}: Missing extrinsic ${extrinsicIdx}`);
            continue;
          }

          const method = `${event.section}.${event.method}`;

          if (method === successEvent) {
            extrinsic.success = true;
          }

          if (method === successEvent || method === failureEvent) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const sanitizedData = event.data.toJSON() as any[];

            for (const data of sanitizedData) {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
              if (data && data.paysFee) {
                extrinsic.paysFee =
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                  data.paysFee === true ||
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                  data.paysFee === 'Yes';

                break;
              }
            }
          }

          extrinsic.events.push(sanitizedEvent);
        } else if (phase.isFinalization) {
          onFinalize.events.push(sanitizedEvent);
        } else if (phase.isInitialization) {
          onInitialize.events.push(sanitizedEvent);
        }
      }
    }

    return {
      number,
      hash,
      parentHash,
      stateRoot,
      extrinsicsRoot,
      authorId,
      logs,
      onInitialize,
      extrinsics,
      onFinalize,
    };
  }

  // --------------------------------------------------------------
  async fetchBalance(hash: BlockHash, address: string): Promise<IAccountBalanceInfo> {

    const [api, header] = await Promise.all([
      this._api.at(hash),
      this._api.rpc.chain.getHeader(hash),
    ]);

    // before Kusama runtime 1050 there was no system.account method, we have to emulate it
    const hasSysAccount = api.query.system.account != undefined;

    let nonce: Index;
    let locks;
    let free: Balance;
    let reserved: Balance;
    let miscFrozen = this._api.createType('Balance', 0);
    let feeFrozen = this._api.createType('Balance', 0);

    let ok = true;

    if (hasSysAccount) {

      const [sysAccount, l] = await Promise.all([
        api.query.system.account(address),
        api.query.balances.locks(address),
      ]);

      const accountData = sysAccount.data != null ? sysAccount.data : await api.query.balances.account(address);

      nonce = sysAccount.nonce;
      locks = l;
      free = accountData.free;
      reserved = accountData.reserved;
      miscFrozen = accountData.miscFrozen;
      feeFrozen = accountData.feeFrozen;
      ok = accountData && locks != undefined;
    }
    else {
      [nonce, free, reserved, locks] = await Promise.all([
        api.query.system.accountNonce(address) as Promise<Index>,
        api.query.balances.freeBalance(address) as Promise<Balance>,
        api.query.balances.reservedBalance(address) as Promise<Balance>,
        api.query.balances.locks(address),
      ]);
      ok = locks != undefined;
    }

    const at = {
      hash,
      height: header.number.toNumber().toString(10),
    };

    if (ok) {
      return {
        at,
        nonce,
        free,
        reserved,
        miscFrozen,
        feeFrozen,
        locks,
      };
    } else {
      throw {
        at,
        error: 'Account not found',
      };
    }
  }

  // Fetch staking information for a Stash account at a given block.
  // @param hash `BlockHash` to make call at
  // @param stash address of the Stash account to get the staking info of
  // returns null, if stash is not a Stash account
  async fetchStakingInfo(hash: BlockHash, stash: string): Promise<IAccountStakingInfo | null> {
    const apiAt = await this._api.at(hash);

    const [header, controllerOption] = await Promise.all([
      this._api.rpc.chain.getHeader(hash),
      apiAt.query.staking.bonded(stash),
    ]);

    const at = {
      hash,
      height: header.number.unwrap().toString(10),
    };

    if (controllerOption.isNone) {
      return null;
      //throw new Error(`The address ${stash} is not a stash address.`);
    }

    const controller = controllerOption.unwrap();

    const [
      stakingLedgerOption,
      rewardDestination,
      slashingSpansOption,
    ] = await Promise.all([
      apiAt.query.staking.ledger(controller),
      apiAt.query.staking.payee(stash),
      apiAt.query.staking.slashingSpans(stash),
    ]);

    const stakingLedger = stakingLedgerOption.unwrapOr(null);

    if (stakingLedger === null) {
      // should never throw because by time we get here we know we have a bonded pair
      throw new Error(`Staking ledger could not be found for controller address "${controller.toString()}"`);
    }

    const numSlashingSpans = slashingSpansOption.isSome
      ? slashingSpansOption.unwrap().prior.length + 1
      : 0;

    return {
      at,
      controller,
      rewardDestination,
      numSlashingSpans,
      staking: stakingLedger,
    };
  }

  // --------------------------------------------------------------
  // Helper function for `parseGenericCall`.
  //
  // @param argsArray array of `Codec` values
  // @param registry type registry of the block the call belongs to

  private parseArrayGenericCalls(argsArray: Codec[], registry: Registry): (Codec | ISanitizedCall)[] {
    return argsArray.map((argument) => {
      if (argument instanceof GenericCall) {
        return this.parseGenericCall(argument, registry);
      }

      return argument;
    });
  }

  // --------------------------------------------------------------
  // Recursively parse a `GenericCall` in order to label its arguments with
  // their param names and give a human friendly method name (opposed to just a
  // call index). Parses `GenericCall`s that are nested as arguments.
  //
  // @param genericCall `GenericCall`
  // @param registry type registry of the block the call belongs to

  private parseGenericCall(genericCall: GenericCall, registry: Registry): ISanitizedCall {
    const newArgs = {};

    // Pull out the struct of arguments to this call
    const callArgs = genericCall.get('args') as Struct;

    // Make sure callArgs exists and we can access its keys
    if (callArgs && callArgs.defKeys) {
      // paramName is a string
      for (const paramName of callArgs.defKeys) {
        const argument = callArgs.get(paramName);

        if (Array.isArray(argument)) {
          newArgs[paramName] = this.parseArrayGenericCalls(argument, registry);
        } else if (argument instanceof GenericCall) {
          newArgs[paramName] = this.parseGenericCall(argument, registry);
        } else if (
          paramName === 'call' &&
          argument?.toRawType() === 'Bytes'
        ) {
          // multiSig.asMulti.args.call is an OpaqueCall (Vec<u8>) that we
          // serialize to a polkadot-js Call and parse so it is not a hex blob.
          try {
            const call = registry.createType(
              'Call',
              argument.toHex()
            );
            newArgs[paramName] = this.parseGenericCall(call, registry);
          } catch {
            newArgs[paramName] = argument;
          }
        } else {
          newArgs[paramName] = argument;
        }
      }
    }

    return {
      method: `${genericCall.section}.${genericCall.method}`,
      callIndex: genericCall.callIndex,
      args: newArgs,
    };
  }

}
