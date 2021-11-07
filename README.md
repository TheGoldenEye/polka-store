# polka-store

## 1 Overview

One of the most used functions of applications based on a blockchain is the
evaluation of transactions. Unfortunately this is not possible in the Polkadot
universe, because transaction data are not directly stored there.  
Ok, you can use the API of a block explorer, but latest if you want to follow the staking-rewards, that's it.

**Polka-store** is a Node.js program written in typescript which scans a Polkadot chain
(Polkadot/Kusama/Westend) and stores (hopefully all) balance-relevant transactions in a SQLite database.
This database can be used in other projects to easily access the transaction data.
What is balance-relevant? Currently the following data will be collected:

- balance transfers (directly and through reserved balance)
- fees
- staking rewards
- staking slashes

Additionally to the balance-relevant transaction data,
also changes in bonded amounts are stored.

Btw, you can download regularly updated example databases from my file storage linked below.

## 2 Installation

### 2.1 Prerequisites

These steps should only be carried out during the initial installation.

#### 2.1.1 Repository

First you have to clone the repository:  

``` bash
git clone https://github.com/TheGoldenEye/polka-store.git
```

#### 2.1.2 Needed packages

We need some prerequisites:

``` bash
sudo apt install node-typescript npm
```

#### 2.1.3 Minimum node.js version

Now its time to check the nodejs version:

``` bash
node -v
```

If your node version is minimum v12.x, its fine. Otherwise you have to install
a newer version, because of the missing BigInt support in Node.js prior to v10.4
and due to the end of maintenance for version 10.x end of April 2021.  
You can do it with the 'n node installer':

``` bash
sudo npm install -g n
sudo n lts
```

Now you should have a current node version installed.

#### 2.1.4 yarn package manager

This repo uses yarn workspaces to organise the code.
As such, after cloning, its dependencies should be installed via yarn package manager,
not via npm, the latter will result in broken dependencies.  
Install yarn, if you haven't already:

``` bash
sudo npm install -g yarn
```

### 2.2 Installing the project dependencies

Please always run this when the sources have been updated from the git repository.

Use yarn to install the dependencies:

``` bash
cd polka-store
yarn
```

## 3 Configuration

### 3.1 config/config.json

Please find a template for configuration in `config/config_tpl.json`.
Instead, the file used by the tool is `config/config.json`.
If the file does not exist, `config/config_tpl.json` is copied to
`config/config.json` during the program start phase.  
You can adapt this file to your needs.

Here are the parameters defined for the different chains.  
Besides the `check_accounts` option there is currently no need to change the default configuration:

``` json
config.json:
{
  "filename": "",
  "defchain": "Polkadot",
  "chains": {
    "Polkadot": {
      "providers": [
        "ws://127.0.0.1:9944",
        "wss://polkadot.elara.patract.io",
        "wss://polkadot.api.onfinality.io/public-ws",
        "wss://rpc.polkadot.io"
      ],
      "startBlock": 892,
      "unit": "DOT",
      "planckPerUnit": 10000000000,
      "check_accounts": [
        { "name": "Example1", "account": "15kUt2i86LHRWCkE3D9Bg1HZAoc2smhn1fwPzDERTb1BXAkX" },
        { "name": "Example2", "account": "12xtAYsRUrmbniiWQqJtECiBQrMn8AypQcXhnQAc6RB6XkLW" }
      ]
    },
    "Kusama": {
      "providers": [
        "ws://127.0.0.1:9944",
        "wss://kusama.elara.patract.io",
        "wss://kusama.api.onfinality.io/public-ws",
        "wss://kusama-rpc.polkadot.io"
      ],
      "startBlock": 3876,
      "unit": "KSM",
      "planckPerUnit": 1000000000000,
      "check_accounts": [
        { "name": "Example1", "account": "HmFYPT1btmi1T9qqs5WtuNJK93yNdnjjhReZh6emgNQvCHa" },
        { "name": "Example2", "account": "GXPPBuUaZYYYvsEquX55AQ1MRvgZ96kniEKyAVDSdv1SX96" }
      ]
    },
    "Westend": {
      "providers": [
        "ws://127.0.0.1:9944",
        "wss://westend-rpc.polkadot.io"
      ],
      "startBlock": 1191,
      "unit": "WND",
      "planckPerUnit": 1000000000000,
      "check_accounts": [
        { "name": "Example1", "account": "5FnD6fKjTFLDKwBvrieQ6ZthZbgMjppynLhKqiRUft9yr8Nf" },
        { "name": "Example2", "account": "5DfdW2r2hyXzGdXFqAVJKGrtxV2UaacnVNr3sAdgCUDc9N9g" }
      ]
    }
  }
}
```

**_Global settings:_**  
**filename:** The path to the sqlite database, the (empty) default means, the
filename is set automatically: "data/\<chainname\>.db"  
**defchain:** The chain which is used (if no chain is given in the command line)  
**_Chain specific settings:_**  
**providers:** An array of websocket urls describing the nodes to connect.
The program tries to connect the first node in list, if connection fails, the next one is used.  
**startBlock:** The first block in the chain to be scanned. The default values
refer to the blocks with the first transactions on chain.
If the database is empty or does not exist, the block scan starts at this block,
if not, at the last block stored in the database.  
**PlanckPerUnit:** Defines the number of Plancks per DOT/KSM/WND, or simply the count of decimal places  
**check_accounts:** A list of accounts used in check mode (see below)

### 3.2 Copy example database

If you do not want to start from scratch, you can copy and unzip my provided example
databases to the data directory. The program will continue scanning the blockchain
starting from the last block found in the database.  
If the data directory is empty, a new database is created and the blockchain is
scanned from the beginning.

Available example databases:

|   Database  | Last Block |     Date     |   Download   |
|:------------|:-----------|:-------------|:-------------|
| Polkadot.db | 7591964    | Nov 07, 2021 | [Polkadot.db.7z](https://e.pcloud.link/publink/show?code=kZx3eZENGTspnf6YLueJK6F2w8ULTpnFIk)  |
| Kusama.db   | 9988183    | Nov 07, 2021 | [Kusama.db.7z](https://e.pcloud.link/publink/show?code=kZx3eZENGTspnf6YLueJK6F2w8ULTpnFIk)    |
| Westend.db  | 8136815    | Nov 07, 2021 | [Westend.db.7z](https://e.pcloud.link/publink/show?code=kZx3eZENGTspnf6YLueJK6F2w8ULTpnFIk)   |

## 4 Running

### 4.1 Compile Typescript

Now you have to build the code (compile typescript to javascript)

``` bash
yarn build
```

### 4.2 Start program

**One** of the following commands starts the tool, collecting data from the **given** chain:

``` bash
yarn polkadot
yarn kusama
yarn westend
```

**Hint:** If you're connected to your own (or local) node, the chain of the node must match the given chain parameter.
Otherwise the program is cancelled.

Your console will show information like this:

``` text
Chain:       Polkadot
Node:        Parity Polkadot v0.8.24-5cbc418a-x86_64-linux-gnu
Provider:    ws://127.0.0.1:9944
API:         @polkadot/api v2.0.1

Press "Ctrl+C" to cancel ...
Block 1823200 / 1831272, 41.8 ms/block, time left: 0 hours 5 min 37 sec
Block 1823354 / 1831273, 43 ms/block, time left: 0 hours 5 min 40 sec
Block 1823521 / 1831274, 36 ms/block, time left: 0 hours 4 min 39 sec
Block 1823668 / 1831275, 41 ms/block, time left: 0 hours 5 min 11 sec
Block 1823820 / 1831276, 39.8 ms/block, time left: 0 hours 4 min 56 sec
```

You can find the block currently scanned, the maximum block count, the processing speed and an estimation, how much time is still needed.

## 5 Database Output

The created SQLite database you can find (by default) in the data directory.  
This is the database structure:

|  Column            | Description                                               |
|:-------------------|:----------------------------------------------------------|
| chain              | chain name                                                |
| id                 | unique id                                                 |
| height             | bock height                                               |
| blockHash          | block hash                                                |
| type               | extrinsic method                                          |
| subType            | extrinsic submethod (e.g. in a 'utility.batch' extrinsic) |
| event              | the event triggered by the extrinsic                      |
| timestamp          | unix timestamp (in ms since Jan 1, 1970)                  |
| specVersion        | runtime version                                           |
| transactionVersion | transaction version                                       |
| authorId           | the account id of the block validator                     |
| senderId           | the account id of the block signer / transaction sender   |
| recipientId        | the account id of the transaction recipient               |
| amount             | the amount which was sent or rewarded                     |
| totalFee           | the fee which was paid by the block signer                |
| feeBalances        | the part of the totalFee that passed to the block author  |
| feeTreasury        | the part of the totalFee that passed to the treasury      |
| tip                | an additional tip paid by the block signer (is part of feeBalances)|
| success            | the transaction was successfull                           |

## 6 Known issues

- Currently no known issues

## 7 Check mode

To make sure that all balance relevant transactions are in the database,
I implemented a check mode. You can configure several accounts for balance check in the config.json:

``` json
"check_accounts": [
        { "name": "Example1", "account": "5FnD6fKjTFLDKwBvrieQ6ZthZbgMjppynLhKqiRUft9yr8Nf" },
        { "name": "Example2", "account": "5DfdW2r2hyXzGdXFqAVJKGrtxV2UaacnVNr3sAdgCUDc9N9g" }
      ]
```

After configuring the accounts, you can start the check mode with one of the following commands:

``` bash
yarn check_polkadot [blockNr]
yarn check_kusama [blockNr]
yarn check_westend [blockNr]
```

For each account the balance at block `blockNr` (or the last block in database,
if `blockNr` is not given) will be calculated based on the database entries.  
Please check the results and report possible missing transactions or issues.  
Thank you for your support!

Here is the example output for westend:

``` text
polka-store: v1.0.2
Chain:       Westend
Node:        Parity Polkadot v0.8.23-d327000a-x86_64-linux-gnu
Provider:    ws://127.0.0.1:9944
API:         @polkadot/api v2.0.1

##########################################
Chain: Westend
Balance data at Block: 2437795 (2020-09-30 16:35:48)
------------------------------------------
Account:     Example1 (5FnD6fKjTFLDKwBvrieQ6ZthZbgMjppynLhKqiRUft9yr8Nf)
Balance:     9899.991 WND (calculated)
Balance ok
------------------------------------------
Account:     Example2 (5DfdW2r2hyXzGdXFqAVJKGrtxV2UaacnVNr3sAdgCUDc9N9g)
Balance:     5371.270799999971 WND (calculated)
Balance ok
```

## 8 Contributions

I welcome contributions. Before submitting your PR, make sure to run the following commands:

- `yarn lint`: Make sure your code follows the linting rules.
- `yarn lint --fix`: Automatically fix linting errors.

<https://github.com/TheGoldenEye/polka-store/graphs/contributors>

## 9 Authors

- GoldenEye
- Used the API-Handler from the "Substrate API Sidecar" project <https://github.com/paritytech/substrate-api-sidecar>

## 10 Please support me

If you like my work, please consider to support me in Polkadot.  
I would be happy if you nominate my validators in the Polkadot / Kusama networks:

**Polkadot:**

1. [Validator GoldenEye](https://polkadot.subscan.io/account/14K71ECxvekU8BXGJmSQLed2XssM3HdBYQBuDUwHeUMUgBHk)
2. [Validator GoldenEye/2](https://polkadot.subscan.io/account/14gYRjn6fn5hu45zEAtXodPDbtaditK8twoWUXFi6DsLwd31)

**Kusama:**

1. [Validator GoldenEye](https://kusama.subscan.io/account/FiNuPk2iPirbKC7Spse3NuE9rWjzaQonZmk6wRvk1LcEU13)
2. [Validator GoldenEye/2](https://kusama.subscan.io/account/GcQXL1HgF1ZETZi3Tw3PoXGWeXbDpfsJrrgNgwxde4uoVaB)
3. [Validator GoldenEye/3](https://kusama.subscan.io/account/HjH4dvyPv2RQMA6XUQPqF37rZZ8seNjPQqYRSm3utdszsin)

## 11 License

GPL-3.0 License  
Copyright (c) 2020 GoldenEye

**Disclaimer:
The tool is provided as-is. I cannot give a guarantee for accuracy and I assume NO LIABILITY.**
