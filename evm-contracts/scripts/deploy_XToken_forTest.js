
const { ethers } = require("hardhat");

async function main() {
  const initialSupply = 100000000; // 初始发行量，例如 1,000,000 代币
  const MyToken = await ethers.getContractFactory("XToken");
  const instance = await MyToken.deploy(initialSupply);

  await instance.deployed();
  console.log("Deployed XToken address:", instance.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
