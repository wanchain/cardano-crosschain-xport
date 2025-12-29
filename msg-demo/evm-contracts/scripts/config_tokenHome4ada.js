
const { ethers } = require("hardhat");
const Config = require("../hardhat.config");
const TokenHomeSc = require("../artifacts/contracts/examples/TokenBridgeV2/ERC20TokenHome4CardanoV2.sol/ERC20TokenHome4CardanoV2.json");

const { Web3 } = require('web3');
// 设置 provider（可以是 Infura、Alchemy、QuickNode 或本地节点）
const web3 = new Web3('https://ethereum-sepolia-rpc.allthatnode.com/your-key');

const PEER_CHAINID = 2147485463;  //cardano preprod chainId (BIP-44) 
const PEER_TOKENREMOTE_INBOUND = 'addr_test1wqzjepm5l3jepgqv42h292u56l5fcsuz8q6j6qtwyvldusq4qmy4n'; 
const PEER_TOKENREMOTE_OUTBOUND = 'addr_test1wzu6ldpnxd7gdc0h5fyrt53utrk6ynudl6w304wc2sh7u9c3vl5le'; 
const LOCAL_TOKENHOME_SCADDRESS = "0xd6Ed4F1F50Cae0c5c7F514F3D0B1220c4a78F71d";

const WAITTING_SECONDS = 30*1000;
// 等待 N 秒
function sleep(time) {
	return new Promise(function (resolve, reject) {
		setTimeout(function () {
			resolve();
		}, time);
	})
}

class TokenHomeUtil {

    constructor(signer, scaddr) {
        this.nodeUrl = Config.networks.wanchainTestnet.url;
        this.abi = TokenHomeSc.abi;
        this.scaddr = scaddr;
        this.signer = signer;
        this.provider = new ethers.providers.JsonRpcProvider(this.nodeUrl);
        this.sc = new ethers.Contract(scaddr, this.abi, this.provider);
    }
    
    async configInboundTokenRemote(peerRemoteChainID, peerTokenRemote) { 
                
        let signedSc = this.sc.connect(this.signer);
        // console.log("\n\n...signedSc: ", signedSc);
        let tx = await signedSc.configInboundTokenRemote(peerRemoteChainID, peerTokenRemote);
        // console.log("\n\n...signedSc: ", signedSc);
        let ret = await tx.wait();
        console.log("\n\n...configTokenRemote...ret:", tx.hash, ret);
    }

    async configOutBoundTokenRemote(peerRemoteChainID, peerTokenRemote) { 
                
        let signedSc = this.sc.connect(this.signer);
        // console.log("\n\n...signedSc: ", signedSc);
        let tx = await signedSc.configOutBoundTokenRemote(peerRemoteChainID, peerTokenRemote);
        // console.log("\n\n...signedSc: ", signedSc);
        let ret = await tx.wait();
        console.log("\n\n...configTokenRemote...ret:", tx.hash, ret);
    }

    async checkTrustAddress (chainid, from) {
        let ret = await this.sc.trustedRemotes(chainid, from);
        console.log('\n\n...checkTrustAddress...ret:', from, ret);``
    }

}

async function main() {

  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  let localTokenHomeScUtil = new TokenHomeUtil(deployer, LOCAL_TOKENHOME_SCADDRESS);

  const bytesAddress_InBound = ethers.utils.hexlify(ethers.utils.toUtf8Bytes(PEER_TOKENREMOTE_INBOUND));
  console.log('Convert PEER_TOKENREMOTE_INBOUND to bytes : ', bytesAddress_InBound);
  const bytesAddress_OutBound = ethers.utils.hexlify(ethers.utils.toUtf8Bytes(PEER_TOKENREMOTE_OUTBOUND));
  console.log('Convert PEER_TOKENREMOTE_OUTBOUND to bytes : ', bytesAddress_OutBound);
  
  
  console.log('\n..To config inbound TokenRemote');
  await localTokenHomeScUtil.configInboundTokenRemote(PEER_CHAINID, bytesAddress_InBound);
  await sleep(WAITTING_SECONDS);
  console.log('\n..To config outbound TokenRemote');
  await localTokenHomeScUtil.configOutBoundTokenRemote(PEER_CHAINID, bytesAddress_OutBound);
  await sleep(WAITTING_SECONDS);

  console.log('\n..To check TokenRemote');
  await localTokenHomeScUtil.checkTrustAddress(PEER_CHAINID, bytesAddress_InBound);
  await localTokenHomeScUtil.checkTrustAddress(PEER_CHAINID, bytesAddress_OutBound);
   
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
