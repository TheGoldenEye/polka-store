import { ApiPromise } from '@polkadot/api';
import { sprintf } from 'sprintf-js';

// --------------------------------------------------------------
// block number console output
// only one output in the given time interval

export class CLogBlockNr {
    private _api: ApiPromise;
    private _lastBlock: number;
    private _lastLoggedBlock: number;
    private _lastLoggingTime: Date;

    constructor(api: ApiPromise, lastBlock: number) {
        this._api = api;
        this._lastBlock = lastBlock;
        this._lastLoggedBlock = 0;
    }

    async LogBlock(errors: number, blockNr: number, force = false, minTime = 2000): Promise<void> {
        if (!this._lastLoggingTime) { // first call
            this._lastLoggedBlock = blockNr;
            this._lastLoggingTime = new Date();
        }

        const d = new Date();
        const diff = d.getTime() - this._lastLoggingTime.getTime();
        if (force || diff >= minTime) {
            const header = await this._api.rpc.chain.getHeader();
            this._lastBlock = header.number.toNumber();

            const timePerBlock = Math.round(diff * 10 / (blockNr - this._lastLoggedBlock)) / 10; // rounded to one decimal place
            const timeLeft = Math.floor(timePerBlock * (this._lastBlock - blockNr) / 1000);
            const s = timeLeft % 60;
            const m = Math.floor(timeLeft / 60) % 60;
            const h = Math.floor(timeLeft / 3600);
            // console.log('Err: %d, Block %d / %d, %f ms/block, time left: %d hours %d min %d sec', errors, blockNr, this._lastBlock, timePerBlock, h, m, s);
            process.stdout.write(sprintf('\rErr: %d, Block %d / %d, %3.0f ms/block, time left: %02d:%02d:%02d ', errors, blockNr, this._lastBlock, timePerBlock, h, m, s));
            this._lastLoggingTime = d;
            this._lastLoggedBlock = blockNr;
        }
    }

    LastBlock(): number {
        return this._lastBlock;
    }

}
