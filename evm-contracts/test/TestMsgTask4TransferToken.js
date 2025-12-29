const { expect } = require("chai");
const { ethers } = require("hardhat");


const Config = require("../hardhat.config");
const Deployed_WanChain = require("../deployed/wanTestnet.json");
const Deployed_Cardano = require("../deployed/cardanoPreprod.json");
const GXTokenSc = require("../deployed/scAbi/XToken.json");
const TokenHomeSc = require("../deployed/scAbi/ERC20TokenHome4CardanoV2.json");

const GXTOKEN_SCADDRESS = Deployed_WanChain.XToken; 
const LOCAL_TOKENHOME_SCADDRESS = Deployed_WanChain.TokenHome; 
const WAITTING_SECONDS = 30*1000;
// 等待 N 秒
function sleep(time) {
	return new Promise(function (resolve, reject) {
		setTimeout(function () {
			resolve();
		}, time);
	})
}

describe("\n\n****Test ERC20TokenHome4Cardano", function () {
  let tokenHome4CardanoSc, tokenHome4CardanoScInst, gxTokenSc, gxTokenScInst, nodeUrl, tokenHomeScAbi, gxTokenScAbi, rpcProvider, owner, testAccount;


  before(async () => {

    [owner, testAccount] = await ethers.getSigners();
    console.log("owner:", owner.address);
    console.log("testAccount:", testAccount.address);

    nodeUrl = Config.networks.wanchainTestnet.url;
    tokenHomeScAbi = TokenHomeSc.abi;
    gxTokenScAbi = GXTokenSc.abi;
    rpcProvider = new ethers.providers.JsonRpcProvider(this.nodeUrl);
    // to create tokenHome sc instance
    tokenHome4CardanoSc = new ethers.Contract(LOCAL_TOKENHOME_SCADDRESS, tokenHomeScAbi, rpcProvider);
    tokenHome4CardanoScInst = tokenHome4CardanoSc.connect(owner);

    // to create token sc instance
    gxTokenSc = new ethers.Contract(GXTOKEN_SCADDRESS, gxTokenScAbi, rpcProvider);
    gxTokenScInst = gxTokenSc.connect(owner);

  });

  
  describe("\n\n===>Tranfer Test-Token", function () {
    it("To transfer token", async function () {
      
      const ownerBalanceBefore = await gxTokenScInst.balanceOf(owner.address);
      const addr1BalanceBefore = await gxTokenScInst.balanceOf(testAccount.address);
      console.log("balance of owner :", ownerBalanceBefore);
      console.log("balance of tokenHome:", addr1BalanceBefore);

      // addr1 批准 owner 可以从其账户转走 token
      const approveAmount = 100000000000;
      await gxTokenScInst.approve(testAccount.address, approveAmount);
      console.log("\nto approve token for owner..");
      await sleep(WAITTING_SECONDS);

      // owner 使用 transferFrom 从 addr1 转给 addr2
      const transferAmount = 1000000000;
      // await gxTokenScInst.transferFrom(owner.address, LOCAL_TOKENHOME_SCADDRESS, transferAmount);
      await gxTokenScInst.transferFrom(owner.address, testAccount.address, transferAmount);
      console.log("transfer token to tokenHome sc..");
      await sleep(WAITTING_SECONDS);

      // 转账后余额
      const ownerBalanceAfter = await gxTokenScInst.balanceOf(owner.address);
      const addr1BalanceAfter = await gxTokenScInst.balanceOf(testAccount.address);
      console.log("\nbalance of owner after transfer:",ownerBalanceAfter);
      console.log("balance of tokenHome after transfer:",addr1BalanceAfter);

    });
  });

});
