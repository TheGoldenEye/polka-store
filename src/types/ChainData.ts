export interface IChainData {
	providers: string[];
	startBlock: number;
	check_accounts: IAccountData[]; 
}                  


interface IAccountData {
  name: string;
  account: string;
}