import { AssetId } from '@polkadot/types/interfaces/runtime';
import { Option } from '@polkadot/types/codec';
import { PalletAssetsAssetDetails } from '@polkadot/types/lookup';
import { AssetMetadata } from '@polkadot/types/interfaces';

import { IAt } from '.';

export interface IAssetInfo {
	at: IAt;
	assetId: AssetId | number;
	assetInfo: Option<PalletAssetsAssetDetails>;
	assetMetaData: AssetMetadata;
}
