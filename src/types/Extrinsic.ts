import {
	Address,
	EcdsaSignature,
	Ed25519Signature,
	RuntimeDispatchInfo,
	Sr25519Signature,
} from '@polkadot/types/interfaces';
import { ICompact, INumber } from '@polkadot/types-codec/types/interfaces';

import { ISanitizedArgs, ISanitizedEvent } from '.';

export interface IExtrinsic {
	method: string;
	signature: ISignature | null;
	nonce: ICompact<INumber> | null;
	args: ISanitizedArgs;
	tip: ICompact<INumber> | null;
	hash: string;
	// eslint-disable-next-line @typescript-eslint/ban-types
	info: RuntimeDispatchInfo | { error: string } | {};
	events: ISanitizedEvent[];
	success: string | boolean;
	paysFee: boolean | null;
}

export interface ISignature {
	signature: EcdsaSignature | Ed25519Signature | Sr25519Signature;
	signer: Address;
}
