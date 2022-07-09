import { IEventData } from '@polkadot/types/types';
import { Codec } from '@polkadot/types-codec/types';

export interface ISanitizedEvent {
	method: string;
	data: Codec[] & IEventData;
}
