
const meshsdk_common = require("@meshsdk/common");
const meshsdk_core = require('@meshsdk/core');

class PlutusUtil {

    constructor(){

    }

    // addr_test1qpm0q3dmc0cq4ea75dum0dgpz4x5jsdf6jk0we04yktpuxnk7pzmhslsptnmagmek76sz92df9q6n49v7ajl2fvkrcdq9semsd
    // 10000
    genBeneficiaryData(receiver, amount) {
        const isValidCardanoAddress = (addr) => {
            try {
                const a = meshsdk_core.deserializeAddress(addr);
                return true;
            } catch (error) {
                return false;
            }
        }
        const to = isValidCardanoAddress(receiver) ? meshsdk_common.mConStr1([this.betch32AddressToMeshData(receiver)]) : meshsdk_core.mConStr0([receiver]);
        let serializedData = meshsdk_core.serializeData(meshsdk_core.mConStr0([to, amount]));
        let hexEncodedData = "0x" + serializedData;
        return hexEncodedData;
    }

    betch32AddressToMeshData(addr) {
        const a = meshsdk_core.deserializeAddress(addr);

        if (a.pubKeyHash) {
            if (a.stakeCredentialHash) return meshsdk_common.mPubKeyAddress(a.pubKeyHash, a.stakeCredentialHash, false);
            else return meshsdk_common.mPubKeyAddress(a.pubKeyHash, a.stakeScriptCredentialHash, true);
        } else {
            if (a.stakeCredentialHash) return meshsdk_common.mScriptAddress(a.scriptHash, a.stakeCredentialHash, false);
            else return meshsdk_common.mScriptAddress(a.scriptHash, a.stakeScriptCredentialHash, true)
        }
    }

};

module.exports = PlutusUtil;
