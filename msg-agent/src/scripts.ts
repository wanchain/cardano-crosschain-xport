import { applyParamsToScript, deserializeAddress, PlutusScript, resolvePlutusScriptAddress, resolveScriptHash } from "@meshsdk/core";
import { mConStr0 } from "@meshsdk/common";
import { defaultConfig } from "./config";

export function getInboundDemoScript() {
  if (!defaultConfig.demoInbound) throw new Error('demoInbound validator not configured');
  const inboundTokenInfo = getInboundTokenScript();
  const scriptCbor = applyParamsToScript(defaultConfig.demoInbound.compiledCode, [inboundTokenInfo.policyId]);
  const script: PlutusScript = {
    code: scriptCbor,
    version: defaultConfig.demoInbound.plutusVersion,
  };
  const scriptAddress = resolvePlutusScriptAddress(script, defaultConfig.NETWORK);
  return { script, scriptAddress };
}

export function getOutboundDemoScript() {
  if (!defaultConfig.demoOutbound) throw new Error('demoOutbound validator not configured');
  const outboundTokenInfo = getOutboundTokenScript();
  const scriptCbor = applyParamsToScript(defaultConfig.demoOutbound.compiledCode, [outboundTokenInfo.policyId]);
  const script: PlutusScript = {
    code: scriptCbor,
    version: defaultConfig.demoOutbound.plutusVersion,
  };
  const scriptAddress = resolvePlutusScriptAddress(script, defaultConfig.NETWORK);
  return { script, scriptAddress };
}

export function getInboundTokenScript() {
  if (!defaultConfig.inboundToken) throw new Error('inboundToken validator not configured');
  let scriptCbor = defaultConfig.inboundToken.compiledCode;

  // Apply CheckTokenInfo { check_token_symbol, check_token_name } when deployed
  const checkSymbol = process.env.CHECK_TOKEN_SYMBOL;
  const checkName = process.env.CHECK_TOKEN_NAME;
  if (checkSymbol || checkName) {
    if (!checkSymbol || !checkName) {
      throw new Error('Both CHECK_TOKEN_SYMBOL and CHECK_TOKEN_NAME must be set (or neither)');
    }
    const checkTokenInfo = mConStr0([checkSymbol, checkName]);
    scriptCbor = applyParamsToScript(scriptCbor, [checkTokenInfo]);
  }

  const script: PlutusScript = {
    code: scriptCbor,
    version: defaultConfig.inboundToken.plutusVersion,
  };
  const policyId = resolveScriptHash(scriptCbor, defaultConfig.inboundToken.plutusVersion);
  return { script, policyId };
}

export function getOutboundTokenScript() {
  if (!defaultConfig.outboundToken) throw new Error('outboundToken validator not configured');
  let scriptCbor = defaultConfig.outboundToken.compiledCode;

  // Apply OutboundTokenParams { group_nft: { symbol, name }, token_name } when deployed
  const groupSymbol = process.env.GROUP_NFT_SYMBOL;
  const groupName = process.env.GROUP_NFT_NAME;
  if (groupSymbol || groupName) {
    if (!groupSymbol || !groupName) {
      throw new Error('Both GROUP_NFT_SYMBOL and GROUP_NFT_NAME must be set (or neither)');
    }
    const groupNftInfo = mConStr0([groupSymbol, groupName]);
    const outboundTokenParam = mConStr0([groupNftInfo, defaultConfig.OUTBOUND_TOKEN_NAME]);
    scriptCbor = applyParamsToScript(scriptCbor, [outboundTokenParam]);
  }

  const script: PlutusScript = {
    code: scriptCbor,
    version: defaultConfig.outboundToken.plutusVersion,
  };
  const policyId = resolveScriptHash(scriptCbor, defaultConfig.outboundToken.plutusVersion);
  return { script, policyId };
}

export function getDemoTokenScript() {
  if (!defaultConfig.demoToken) throw new Error('demoToken validator not configured');
  const { scriptAddress } = getInboundDemoScript();
  const a = deserializeAddress(scriptAddress);
  const scriptCbor = applyParamsToScript(defaultConfig.demoToken.compiledCode, [a.scriptHash, defaultConfig.demoTokenName]);
  const script: PlutusScript = {
    code: scriptCbor,
    version: defaultConfig.demoToken.plutusVersion,
  };
  const policyId = resolveScriptHash(scriptCbor, defaultConfig.demoToken.plutusVersion);
  return { script, policyId };
}

export function getXPortScript() {
  if (!defaultConfig.xport) throw new Error('xport validator not configured');
  let scriptCbor = defaultConfig.xport.compiledCode;

  // Apply KeyParam { pkh, nonce } when deployed
  const pkh = process.env.XPORT_PKH;
  const nonce = process.env.XPORT_NONCE;
  if (pkh) {
    const nonceNum = parseInt(nonce || '0', 10);
    if (isNaN(nonceNum)) throw new Error(`XPORT_NONCE must be a number, got: "${nonce}"`);
    const xportParam = mConStr0([pkh, nonceNum]);
    scriptCbor = applyParamsToScript(scriptCbor, [xportParam]);
  }

  const script: PlutusScript = {
    code: scriptCbor,
    version: defaultConfig.xport.plutusVersion,
  };
  const scriptAddress = resolvePlutusScriptAddress(script, defaultConfig.NETWORK);
  return { script, scriptAddress };
}

const inboundTokenInfo = getInboundTokenScript();
const outboundTokenInfo = getOutboundTokenScript();
const inboundDemoInfo = getInboundDemoScript();
const outboundDemoInfo = getOutboundDemoScript();
const xportInfo = getXPortScript();
const demoTokenInfo = getDemoTokenScript();

export default {
  inboundTokenPolicy: inboundTokenInfo.policyId,
  inboundTokenScript: inboundTokenInfo.script,
  outboundTokenPolicy: outboundTokenInfo.policyId,
  outboundTokenScript: outboundTokenInfo.script,
  inboundDemoAddress: inboundDemoInfo.scriptAddress,
  inboundDemoScript: inboundDemoInfo.script,
  outboundDemoScript: outboundDemoInfo.script,
  outboundDemoAddress: outboundDemoInfo.scriptAddress,
  xportScript: xportInfo.script,
  xportAddress: xportInfo.scriptAddress,
  demoTokenPolicy: demoTokenInfo.policyId,
  demoTokenScript: demoTokenInfo.script,
}
