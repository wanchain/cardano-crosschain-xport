
import * as crossChainPlutus from '../../cross-chain/plutus.json'


export interface Validator {
    compiledCode: string;
    plutusVersion: "V3" | "V2" | "V1"
}
export interface Config {
    OUTBOUND_TOKEN_NAME: string;
    GroupNftHolder: string;
    NETWORK: number;
    EvmContractADDRESS: string;
    demoTokenName: string;
    demoInbound?: Validator;
    demoOutbound?: Validator;
    demoToken?: Validator;
    inboundToken?: Validator;
    outboundToken?: Validator;
    // Production cross-chain validators (Aiken V3)
    groupNftHolder?: Validator;
    adminNftHolder?: Validator;
    checkToken?: Validator;
    inboundMintCheck?: Validator;
    xport?: Validator;
    EvmChainId: number;
    AdaChainId: number;
}

const loadCrossChainComp = (name: string) => {
    const validator = crossChainPlutus.validators.find(v => v.title == name);
    if (validator) {
        return { compiledCode: validator.compiledCode, plutusVersion: crossChainPlutus.preamble.plutusVersion.toUpperCase() } as Validator
    }
};

export const defaultConfig: Config = {
    OUTBOUND_TOKEN_NAME: Buffer.from("OutboundTokenCoin", 'ascii').toString('hex'),
    GroupNftHolder: process.env.GROUP_NFT_HOLDER || 'addr_test1wpm9vmfxjk0lcrcwzfx76zmcyxpfluux9cwppyu9639thycpks2wj',
    NETWORK: parseInt(process.env.NETWORK || '0'), // 0 testnet 1 mainnet
    EvmContractADDRESS: (process.env.EVM_CONTRACT_ADDRESS || '0xd6Ed4F1F50Cae0c5c7F514F3D0B1220c4a78F71d').toLowerCase(),
    demoTokenName:  Buffer.from('DemoToken','ascii').toString('hex'),
    demoInbound: loadCrossChainComp('demo/inbound_handler.inbound_handler.spend'),
    demoOutbound: loadCrossChainComp('demo/outbound_handler.outbound_handler.spend'),
    demoToken: loadCrossChainComp('demo/bridge_token.bridge_token.mint'),

    // Inbound token: LOCAL_INBOUND_TOKEN override → cross-chain Aiken V3 → (no fallback)
    inboundToken: process.env.LOCAL_INBOUND_TOKEN
        ? { compiledCode: process.env.LOCAL_INBOUND_TOKEN, plutusVersion: (process.env.LOCAL_INBOUND_TOKEN_VERSION || 'V2') as 'V2' | 'V3' }
        : loadCrossChainComp('inbound_token.inbound_token.mint'),

    // Outbound token: LOCAL_OUTBOUND_TOKEN override → cross-chain Aiken V3 → (no fallback)
    outboundToken: process.env.LOCAL_OUTBOUND_TOKEN
        ? { compiledCode: process.env.LOCAL_OUTBOUND_TOKEN, plutusVersion: (process.env.LOCAL_OUTBOUND_TOKEN_VERSION || 'V2') as 'V2' | 'V3' }
        : loadCrossChainComp('outbound_token.outbound_token.mint'),

    // Production cross-chain validators (Aiken V3)
    groupNftHolder: loadCrossChainComp('group_nft_holder.group_nft_holder.spend'),
    adminNftHolder: loadCrossChainComp('admin_nft_holder.admin_nft_holder.spend'),
    checkToken: loadCrossChainComp('check_token.check_token.mint'),
    inboundMintCheck: loadCrossChainComp('inbound_mint_check.inbound_mint_check.spend'),
    xport: loadCrossChainComp('xport.xport.spend'),

    EvmChainId: parseInt(process.env.EVM_CHAIN_ID || '2153201998'),
    AdaChainId: parseInt(process.env.ADA_CHAIN_ID || '2147485463')
}
