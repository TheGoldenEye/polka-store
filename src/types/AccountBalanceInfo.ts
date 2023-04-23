import { Vec } from '@polkadot/types';
import { Balance, BalanceLock, Index } from '@polkadot/types/interfaces';

import { IAt } from '.';

export interface IAccountBalanceInfo {
	at: IAt;
	nonce: Index;
	free: Balance;
	reserved: Balance;
	frozen: Balance;
	locks: Vec<BalanceLock>;
}
