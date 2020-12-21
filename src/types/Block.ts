import { Compact } from '@polkadot/types';
import { AccountId, Address } from '@polkadot/types/interfaces/runtime';
import {
	Balance,
	BlockHash,
	BlockNumber,
	EcdsaSignature,
	Ed25519Signature,
	Hash,
	Index,
	RuntimeDispatchInfo,
	Sr25519Signature,
} from '@polkadot/types/interfaces';
import { Codec } from '@polkadot/types/types';

import { ISanitizedArgs, ISanitizedEvent } from '.';

export interface IBlock {
	number: Compact<BlockNumber>;
	hash: BlockHash;
	parentHash: Hash;
	stateRoot: Hash;
	extrinsicsRoot: Hash;
	authorId: AccountId | undefined;
	logs: ILog[];
	onInitialize: IOnInitializeOrFinalize;
	extrinsics: IExtrinsic[];
	onFinalize: IOnInitializeOrFinalize;
}

export interface IExtrinsic {
	method: string;
	signature: ISignature | null;
	nonce: Compact<Index>;
	args: Codec[];
	newArgs: ISanitizedArgs;
	tip: Compact<Balance>;
	hash: string;
	// eslint-disable-next-line @typescript-eslint/ban-types
	info: RuntimeDispatchInfo | { error: string } | {};
	events: ISanitizedEvent[];
	success: string | boolean;
	paysFee: boolean | null;
}

export interface IOnInitializeOrFinalize {
	events: ISanitizedEvent[];
}

export interface ISignature {
	signature: EcdsaSignature | Ed25519Signature | Sr25519Signature;
	signer: Address;
}

export interface ILog {
	type: string;
	index: number;
	value: Codec;
}
