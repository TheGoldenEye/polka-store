-- Up
UPDATE transactions SET event = 'staking.Bonded' WHERE event = 'staking.Bonded_e';

-- Down
