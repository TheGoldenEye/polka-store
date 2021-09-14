-- Up
UPDATE transactions SET event = 'staking.Rewarded' WHERE event = 'staking.Reward';
UPDATE transactions SET event = 'staking.Slashed' WHERE event = 'staking.Slash';

-- Down
