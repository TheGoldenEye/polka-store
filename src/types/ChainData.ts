export interface IChainData {
	providers: string[];
	startBlock: number;
	unit: string;
	planckPerUnit: number;
	check_accounts: IAccountData[]; 
}                  


interface IAccountData {
  name: string;
  account: string;
}