const { expect } = require("chai");
const { ethers } = require("hardhat");

const Config = require("../hardhat.config");
const Deployed_WanChain = require("../deployed/wanTestnet.json");
const Deployed_Cardano = require("../deployed/cardanoPreprod.json");
const GXTokenSc = require("../deployed/scAbi/XToken.json");
const TokenHomeSc = require("../deployed/scAbi/ERC20TokenHome4CardanoV2.json");

const PlutusUtils = require("../utils/plutusDataTool.js");
const plutusUtilObj = new PlutusUtils();

const EVM_GXTOKEN_SCADDRESS = Deployed_WanChain.XToken; 
const EVM_TOKENHOME_SCADDRESS = Deployed_WanChain.TokenHome; 
const WAITTING_SECONDS = 30 * 1000;


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
    tokenHome4CardanoSc = new ethers.Contract(EVM_TOKENHOME_SCADDRESS, tokenHomeScAbi, rpcProvider);
    tokenHome4CardanoScInst = tokenHome4CardanoSc.connect(testAccount); //owner

    // to create token sc instance
    gxTokenSc = new ethers.Contract(EVM_GXTOKEN_SCADDRESS, gxTokenScAbi, rpcProvider);
    gxTokenScInst = gxTokenSc.connect(testAccount); //owner

  });


  describe("\n\n===>To Cross Token from Wan to Cardano", function () {
    it("To decode plutusData by calling TokenHome's send function", async function () {

      const addr1BalanceBefore = await gxTokenScInst.balanceOf(testAccount.address);
      console.log("balance of test account:", addr1BalanceBefore);

      const approveAmount = 10000000;
      await gxTokenScInst.approve(EVM_TOKENHOME_SCADDRESS, approveAmount);
      console.log("to approve token for tokenHome sc..");
      await sleep(WAITTING_SECONDS);

      let targetAddr = "addr_test1qpm0q3dmc0cq4ea75dum0dgpz4x5jsdf6jk0we04yktpuxnk7pzmhslsptnmagmek76sz92df9q6n49v7ajl2fvkrcdq9semsd";
      let amount = 10000;
      let plutusDataMsg = plutusUtilObj.genBeneficiaryData(targetAddr, amount)
      console.log("\n\n..plutusDataMsg: ", plutusDataMsg);

      await tokenHome4CardanoScInst.send(
        plutusDataMsg
      );

      await sleep(WAITTING_SECONDS);
      const addr1BalanceAfter = await gxTokenScInst.balanceOf(testAccount.address);
      console.log("balance of test account:", addr1BalanceAfter);

    });
  });


});
