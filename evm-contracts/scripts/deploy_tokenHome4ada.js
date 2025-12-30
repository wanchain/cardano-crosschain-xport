// scripts/deploy.js
const Deployed_Wanchain = require("../deployed/wanTestnet.json");

const OWNER_ADDRESS = Deployed_Wanchain.TokenHomeOwnerAddr;
const GATEWAY_ADDRESS = Deployed_Wanchain.WmbGateway;
const TOKEN_ADDRESS = Deployed_Wanchain.XToken; 

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("\n\n\n...Deploying contracts with the account:", deployer.address);

  
  const Logic = await ethers.getContractFactory('ERC20TokenHome4CardanoV2', {
    libraries: {
      // ByteParser: byteParserLib.address,
      // CBORDecoding: cBORDecodingLib.address,
      // CBOREncoding: cBOREncodingLib.address
    }
  });

  const instance = await Logic.deploy(
    GATEWAY_ADDRESS,
    TOKEN_ADDRESS
  );
  await instance.deployed();
  console.log("ERC20TokenHome4CardanoV2 deployed to:", instance.address);

  console.log("Contract deployed successfully!");
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
