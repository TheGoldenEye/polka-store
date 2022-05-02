import { ApiPromise, WsProvider } from '@polkadot/api';
import { ApiDecoration } from '@polkadot/api/types';
import { Struct, StorageKey, bool, Null, u128 } from '@polkadot/types';
import { GenericCall } from '@polkadot/types/generic';
import { Codec, Registry } from '@polkadot/types/types';
import { BlockHash } from '@polkadot/types/interfaces/chain';
import { u8aToHex } from '@polkadot/util';
import { blake2AsU8a } from '@polkadot/util-crypto';
import { AssetId, Balance, Index } from '@polkadot/types/interfaces';

import { IAssetBalance, IAccountAssetsBalances, IAccountBalanceInfo, IAccountStakingInfo, IBlock, ISanitizedCall, ISanitizedEvent, IAssetInfo } from './types';

// These two types (`PalletAssetsAssetBalance, LegacyPalletAssetsAssetBalance`) are necessary for any
// runtime pre 9160. It excludes the `reason` field which v9160 introduces via the following PR.
// https://github.com/paritytech/substrate/pull/10382/files#diff-9acae09f48474b7f0b96e7a3d66644e0ce5179464cbb0e00671ad09aa3f73a5fR88
//
// `LegacyPalletAssetsAssetBalance` which is the oldest historic type here had a `isSufficient`
// key. It was then updated to be `sufficient` which we represent here within `PalletAssetsAssetBalance`.
//
// v9160 removes the `sufficient` key typed as a boolean, and instead
// replaces it with a `reason` key. `reason` is an enum and has the following values
// in polkadot-js: (`isConsumer`, `isSufficient`, `isDepositHeld`, `asDepositHeld`, `isDepositRefunded`, `type`).
//
// For v9160 and future runtimes, the returned type is `PalletAssetsAssetAccount`.

interface PalletAssetsAssetBalance extends Struct {
  readonly balance: u128;
  readonly isFrozen: bool;
  readonly sufficient: bool;
  readonly extra: Null;
}

interface LegacyPalletAssetsAssetBalance extends Struct {
  readonly balance: u128;
  readonly isFrozen: bool;
  readonly isSufficient: bool;
}

// --------------------------------------------------------------
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

    if (!apiAt.query.staking || !apiAt.query.staking.bonded)
      return null; // bonding not available

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
  // Fetch all the `AssetBalance`s alongside their `AssetId`'s for a given array of queried `AssetId`'s.
  // If none are queried the function will get all `AssetId`'s associated with the
  // given `AccountId`, and send back all the `AssetsBalance`s.
  // @param hash `BlockHash` to make call at
  // @param address `AccountId` associated with the balances
  // @param assets An array of `assetId`'s to be queried. If the length is zero
  // all assetId's associated to the account will be queried

  async fetchAssetBalances(hash: BlockHash, address: string, assets: number[]): Promise<IAccountAssetsBalances> {
    const apiAt = await this._api.at(hash);

    const { number } = await this._api.rpc.chain.getHeader(hash);

    let response: IAssetBalance[] = [];

    // Check if this runtime has the assets pallet
    if (apiAt.query.assets) { // Only, if the runtime includes assets pallet at this block

      if (!assets.length) {
        // query all assets and return them in an array
        const keys = await apiAt.query.assets.asset.keys();
        const assetIds = this.extractAssetIds(keys);

        response = await this.queryAssets(apiAt, assetIds, address);
      } else {
        // query all assets by the requested AssetIds
        response = await this.queryAssets(apiAt, assets, address);
      }
    }

    const at = {
      hash,
      height: number.unwrap().toString(10),
    };

    return {
      at,
      assets: response,
    };
  }


  // --------------------------------------------------------------
  // Fetch an asset's `AssetDetails` and `AssetMetadata` with its `AssetId`.
  // @param hash `BlockHash` to make call at
  // @param assetId `AssetId` used to get info and metadata for an asset

  async fetchAssetById(hash: BlockHash, assetId: number | AssetId): Promise<IAssetInfo> {
    const [{ number }, assetInfo, assetMetaData] = await Promise.all([
      this._api.rpc.chain.getHeader(hash),
      this._api.query.assets.asset(assetId),
      this._api.query.assets.metadata(assetId),
    ]);

    const at = {
      hash,
      height: number.unwrap().toString(10),
    };

    return {
      at,
      assetId,
      assetInfo,
      assetMetaData,
    };
  }

  // --------------------------------------------------------------
  // Fetch asset's `AssetDetails` and `AssetMetadata` for all assets
  // @param hash `BlockHash` to make call at

  async fetchAllAssets(hash: BlockHash): Promise<IAssetInfo[]> {
    const apiAt = await this._api.at(hash);

    const ret: IAssetInfo[] = [];
    if (!apiAt.query.assets)    // chain has no asset Support
      return ret;

    const [{ number }, keys] = await Promise.all([
      this._api.rpc.chain.getHeader(hash),
      apiAt.query.assets.asset.keys(),
    ]);

    const at = {
      hash,
      height: number.unwrap().toString(10),
    };

    const assetIds = this.extractAssetIds(keys);

    for (let i = 0, n = assetIds.length; i < n; i++) {
      const assetId = assetIds[i];
      const [assetInfo, assetMetaData] = await Promise.all([
        this._api.query.assets.asset(assetId),    // use the latest asset data (not using apiAt)
        this._api.query.assets.metadata(assetId),
      ]);
      ret.push({ at, assetId, assetInfo, assetMetaData })
    }

    return ret;
  }

  // --------------------------------------------------------------
  // @param keys Extract `assetId`s from an array of storage keys
  private extractAssetIds(keys: StorageKey<[AssetId]>[]): AssetId[] {
    return keys.map(({ args: [assetId] }) => assetId);
  }

  // --------------------------------------------------------------
  // Takes in an array of `AssetId`s, and an `AccountId` and returns
  // all balances tied to those `AssetId`s.
  // @param api ApiPromise
  // @param assets An Array of `AssetId`s or numbers representing `assetId`s
  // @param address An `AccountId` associated with the queried path

  private async queryAssets(apiAt: ApiDecoration<'promise'>, assets: AssetId[] | number[], address: string): Promise<IAssetBalance[]> {
    return Promise.all(
      assets.map(async (assetId: AssetId | number) => {
        const assetBalance = await apiAt.query.assets.account(assetId, address);

        // The following checks for three different cases:

        // 1. Via runtime v9160 the updated storage introduces a `reason` field,
        // and polkadot-js wraps the newly returned `PalletAssetsAssetAccount` in an `Option`.
        if (assetBalance.isSome) {
          const balanceProps = assetBalance.unwrap();

          return {
            assetId,
            balance: balanceProps.balance,
            isFrozen: balanceProps.isFrozen,
            isSufficient: balanceProps.reason.isSufficient,
          };
        }

        // 2. `query.assets.account()` return `PalletAssetsAssetBalance` which exludes `reasons` but has `sufficient` as a key.
        if ((assetBalance as unknown as PalletAssetsAssetBalance).sufficient) {
          const balanceProps =
            assetBalance as unknown as PalletAssetsAssetBalance;

          return {
            assetId,
            balance: balanceProps.balance,
            isFrozen: balanceProps.isFrozen,
            isSufficient: balanceProps.sufficient,
          };
        }

        // 3. The older legacy type of `PalletAssetsAssetBalance` has a key of `isSufficient` instead of `sufficient`.
        if (assetBalance['isSufficient'] as bool) {
          const balanceProps =
            assetBalance as unknown as LegacyPalletAssetsAssetBalance;

          return {
            assetId,
            balance: balanceProps.balance,
            isFrozen: balanceProps.isFrozen,
            isSufficient: balanceProps.isSufficient,
          };
        }

        /**
         * This return value wont ever be reached as polkadot-js defaults the
         * `balance` value to `0`, `isFrozen` to false, and `isSufficient` to false.
         * This ensures that the typescript compiler is happy, but we also follow along
         * with polkadot-js/substrate convention.
         */
        return {
          assetId,
          balance: apiAt.registry.createType('u128', 0),
          isFrozen: apiAt.registry.createType('bool', false),
          isSufficient: apiAt.registry.createType('bool', false),
        };
      })
    );
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
