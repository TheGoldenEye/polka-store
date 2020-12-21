import { GenericEventData } from '@polkadot/types';

export interface ISanitizedEvent {
	method: string;
	data: GenericEventData;
}
