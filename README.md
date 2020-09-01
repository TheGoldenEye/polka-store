# polka-store

## 1 Overview

Polka-store is a Node.js program written in typescript to store balance-relevant
transactions from a Polkadot chain (Polkadot/Kusama/Westend) in a SQLite database.
This database can be used in other projects to easily access the transaction data.
What is balance-relevant? Currently the following data will be collected:

- balance transfers
- fees
- staking rewards
- staking slashes

## 2 Installation

### 2.1 Prerequisites

These steps should only be carried out during the initial installation.

#### 2.1.1 Repository

Clone the repository:

``` bash
git clone https://github.com/TheGoldenEye/polka-store.git
```

#### 2.1.2 Rust

The project uses rust code to calculate the transaction fees. Please make sure
your machine has an up-to-date version of `rustup` installed.  
Please check, if `rustup` is installed:

``` bash
rustup -V
```

If rustup is not installed, please install rust from here: <https://www.rust-lang.org/tools/install>

Alternatively you can execute the rust installer directly:

``` bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Hint: The rust installer changes the PATH environment variable.
If the `rustup` command is still unavailable, restart the console and/or logoff the user.

#### 2.1.3 Needad packages

We need some prerequisites:

``` bash
sudo apt install pkg-config node-typescript libssl-dev npm build-essential
```

#### 2.1.4 Install wasm-pack

`wasm-pack` is needed by the rust code.
Please install it, if your machine does not already have it:

``` bash
cargo install wasm-pack
```

#### 2.1.5 Minimum node.js version

Now its time to check the nodejs version:

``` bash
node -v
```

If your node version is minimum v10.4.0, its fine. Otherwise you have to install
a newer version, because of the missing BigInt support in Node.js prior to v10.4.  
You can do it with the 'n node installer':

``` bash
sudo npm install -g n
sudo n lts
```

Now you should have a current node version installed.

#### 2.1.6 yarn package manager

This repo uses yarn workspaces to organise the code.
As such, after cloning, its dependencies should be installed via yarn package manager, not via npm, the latter will result in broken dependencies.  
Install yarn, if you haven't already:

``` bash
sudo npm install -g yarn
```

### 2.2 Installing the project dependencies

Please always run this when the sources have been updated from the git repository.

Use yarn to install the dependencies:

``` bash
yarn
```

## 3 Configuration

## 4 Running

Now you have to build the code

``` bash
yarn build
```

One of the following commands starts the tool, collecting data from the given chain:

``` bash
yarn polkadot
yarn kusama
yarn westend
```

## 5 Contributions

I welcome contributions. Before submitting your PR, make sure to run the following commands:

- `yarn lint`: Make sure your code follows the linting rules.
- `yarn lint --fix`: Automatically fix linting errors.

<https://github.com/TheGoldenEye/polka-store/graphs/contributors>

## 6 Authors

- GoldenEye
- Used some parts of the "Substrate API Sidecar" project <https://github.com/paritytech/substrate-api-sidecar>  
  (Fee calculation tool and API-Handler)

## 7 License

Apache-2.0  
Copyright (c) 2020 GoldenEye

**Disclaimer:
The tool is provided as-is. I cannot give a guarantee for accuracy and I assume NO LIABILITY.**
