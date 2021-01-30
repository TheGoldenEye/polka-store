import { ApiPromise } from '@polkadot/api';
import { Struct } from '@polkadot/types';
import { GenericCall } from '@polkadot/types/generic';
import { Codec, Registry } from '@polkadot/types/types';
import { BlockHash } from '@polkadot/types/interfaces/chain';
import { u8aToHex } from '@polkadot/util';
import { blake2AsU8a } from '@polkadot/util-crypto';

import { IAccountBalanceInfo, IBlock, ISanitizedCall, ISanitizedEvent } from './types';

export default class ApiHandler {

  constructor(private api: ApiPromise) {
  }

  async fetchBlock(hash: BlockHash): Promise<IBlock> {
    const { api } = this;
    const [{ block }, events] = await Promise.all([
      api.rpc.chain.getBlock(hash),
      api.query.system.events.at(hash),
    ]);

    const { parentHash, number, stateRoot, extrinsicsRoot } = block.header;
    const onInitialize = { events: [] as ISanitizedEvent[] };
    const onFinalize = { events: [] as ISanitizedEvent[] };

    const header = await api.derive.chain.getHeader(hash);
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
      const call = block.registry.createType('Call', method);

      return {
        method: `${method.section}.${method.method}`,
        signature: isSigned ? { signature, signer } : null,
        nonce,
        args: this.parseGenericCall(call, block.registry).args,
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

  async fetchBalance(
    hash: BlockHash,
    address: string
  ): Promise<IAccountBalanceInfo> {
    const { api } = this;

    const [header, locks, sysAccount] = await Promise.all([
      api.rpc.chain.getHeader(hash),
      api.query.balances.locks.at(hash, address),
      api.query.system.account.at(hash, address),
    ]);

    const account =
      sysAccount.data != null
        ? sysAccount.data
        : await api.query.balances.account.at(hash, address);

    const at = {
      hash,
      height: header.number.toNumber().toString(10),
    };

    if (account && locks && sysAccount) {
      const { free, reserved, miscFrozen, feeFrozen } = account;
      const { nonce } = sysAccount;

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

  /**
   * Helper function for `parseGenericCall`.
   *
   * @param argsArray array of `Codec` values
   * @param registry type registry of the block the call belongs to
   */
  private parseArrayGenericCalls(argsArray: Codec[], registry: Registry): (Codec | ISanitizedCall)[] {
    return argsArray.map((argument) => {
      if (argument instanceof GenericCall) {
        return this.parseGenericCall(argument, registry);
      }

      return argument;
    });
  }

  /**
   * Recursively parse a `GenericCall` in order to label its arguments with
   * their param names and give a human friendly method name (opposed to just a
   * call index). Parses `GenericCall`s that are nested as arguments.
   *
   * @param genericCall `GenericCall`
   * @param registry type registry of the block the call belongs to
   */
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
