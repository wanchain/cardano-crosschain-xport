require("@nomicfoundation/hardhat-toolbox");
require("ts-node/register/transpile-only");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.18",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          },
        }
      },
      {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          },
          evmVersion: "london"
        }
      }
    ]
  },
  mocha: {
    timeout: 100000000
  },
  networks: {
    dioneMainnet:{
      url: "https://node.dioneprotocol.com/ext/bc/D/rpc",
      accounts: [process.env.PK],
      bip44ChainId: 1073741848,
    },
    waterfallMainnet: {
      url: "https://rpc.waterfall.network",
      accounts: [process.env.PK],
    },
    wanchainTestnet: {
      url: "https://gwan-ssl.wandevs.org:46891",
      accounts: [process.env.PK, process.env.PK2].filter(Boolean),
      chainId: 999,
      gasPrice: 3e9,
      gas: 30000000,
    },
    wanchainMainnet: {
      url: "https://gwan-ssl.wandevs.org:56891",
      accounts: [process.env.PK],
      chainId: 888,
      gasPrice: 2e9,
      gas: 30000000,
    },
    goerli: {
      url: 'https://rpc.ankr.com/eth_goerli',
      accounts: [process.env.PK],
    },
    fuji: {
      url: 'https://ava-testnet.public.blastapi.io/ext/bc/C/rpc',
      accounts: [process.env.PK],
      chainId: 43113,
    },
    xdcTestnet: {
      url: 'https://erpc.apothem.network',
      accounts: [process.env.PK],
    },
    arbitrumGoerli: {
      url: 'https://arbitrum-goerli.publicnode.com',
      accounts: [process.env.PK],
    },
    optimisticGoerli: {
      url: 'https://optimism-goerli.publicnode.com',
      accounts: [process.env.PK],
      gasPrice: 0.01e9,
    },
    polygonMumbai: {
      url: 'https://polygon-mumbai-bor.publicnode.com',
      accounts: [process.env.PK],
    },
    polygon: {
      url: 'https://polygon-bor.publicnode.com',
      accounts: [process.env.PK],
    },
    mainnet: {
      url: 'https://ethereum.publicnode.com',
      accounts: [process.env.PK],
    },
    sepolia: {
      url: `https://sepolia.infura.io/v3/${process.env.INFURA_PROJECT_ID}`,
      accounts: [process.env.PK],
      chainId: 11155111, // Sepolia 的链 ID
      gas: "auto", // 自动估算 gas 限制
      gasPrice: "auto", // 自动估算 gas 价格
    }
  },
  etherscan: {
    apiKey: {
    }
  }
};
