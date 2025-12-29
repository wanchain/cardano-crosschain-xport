const { expect } = require("chai");
const { ethers } = require("hardhat");

const Config = require("../hardhat.config");
const GXTokenSc = require("./scAbi/XToken.json");
const TokenHomeSc = require("./scAbi/ERC20TokenHome4CardanoV2.json");

const EVM_GXTOKEN_SCADDRESS = "0x0B40EF8f0bA69C39f8dD7Eeab073275c72593aa2";
const EVM_TOKENHOME_SCADDRESS = "0xd6Ed4F1F50Cae0c5c7F514F3D0B1220c4a78F71d";
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

      const plutusDataMsg = "0xd8799fd87a9fd8799fd8799f581c76f045bbc3f00ae7bea379b7b501154d4941a9d4acf765f525961e1affd8799fd8799fd8799f581c76f045bbc3f00ae7bea379b7b501154d4941a9d4acf765f525961e1affffffffff192710ff";
      await tokenHome4CardanoScInst.send(
        plutusDataMsg
      );


      await sleep(WAITTING_SECONDS);
      const addr1BalanceAfter = await gxTokenScInst.balanceOf(testAccount.address);
      console.log("balance of test account:", addr1BalanceAfter);

    });
  });


});
