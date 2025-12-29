// scripts/deploy.js

const OWNER_ADDRESS = '0x2aefeecc53c18b231ea92b5f0772bd85272f8770';
const GATEWAY_ADDRESS = '0xDDddd58428706FEdD013b3A761c6E40723a7911d';
const TOKEN_ADDRESS = '0x0B40EF8f0bA69C39f8dD7Eeab073275c72593aa2'; 

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
