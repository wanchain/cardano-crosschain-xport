#!/usr/bin/env ts-node
/**
 * test-local.ts — Create test tasks on the local Yaci DevKit devnet.
 *
 * Prerequisites:
 *   docker compose up -d              (from repo root)
 *   npx ts-node scripts/deploy-local.ts  (fund wallets & deploy)
 *   Update .env with values from deploy script
 *
 * Usage:
 *   cd msg-agent
 *   npx ts-node scripts/test-local.ts outbound   # Create an outbound task
 *   npx ts-node scripts/test-local.ts check       # Check UTxOs at contract addresses
 */

import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config({ path: path.join(__dirname, '../', '.env') });

import { BlockfrostProvider, YaciProvider, MeshWallet, MeshTxBuilder, Transaction, PlutusScript, serializeData, resolveScriptHash, resolvePlutusScriptAddress, applyParamsToScript, deserializeAddress, ForgeScript } from '@meshsdk/core';
import { mConStr0, mConStr1, mScriptAddress } from "@meshsdk/common";
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2';
import { sha3_256 } from '@noble/hashes/sha3';
import { defaultConfig } from '../src/config';
import contractsInfo from '../src/scripts';
import { genBeneficiaryData, bech32AddressToMeshData, getMsgCrossDataFromCbor } from '../src/datum';

// Wire up sha512 for @noble/ed25519 sync functions (sign, getPublicKey, verify)
(ed.hashes as any).sha512 = (...msgs: Uint8Array[]) => sha512(ed.etc.concatBytes(...msgs));

const YACI_STORE_URL = process.env.BLOCKFROST_URL || 'http://localhost:8080/api/v1';
const YACI_ADMIN_URL = process.env.YACI_ADMIN_URL;

function getProvider(): YaciProvider | BlockfrostProvider {
    if (YACI_ADMIN_URL) {
        return new YaciProvider(YACI_ADMIN_URL + '/local-cluster/api');
    }
    const endpoint = process.env.BLOCKFROST_URL || process.env.BLOCKFROST_API_KEY;
    if (!endpoint) throw new Error('YACI_ADMIN_URL, BLOCKFROST_URL, or BLOCKFROST_API_KEY must be set');
    return new BlockfrostProvider(endpoint);
}

async function loadWallet(seed: string): Promise<MeshWallet> {
    const provider = getProvider();
    const wallet = new MeshWallet({
        networkId: 0,
        fetcher: provider,
        submitter: provider,
        key: { type: 'cli', payment: '5820' + seed },
    });
    await wallet.init();
    return wallet;
}

async function createOutboundTask() {
    console.log('=== Creating Outbound Task ===\n');

    const seed = process.env.ACCOUNT_SEED3;
    if (!seed) { console.error('ACCOUNT_SEED3 not set'); process.exit(1); }

    const provider = getProvider();
    const wallet = await loadWallet(seed);
    const addr = wallet.addresses.baseAddressBech32 ?? '';
    console.log(`User wallet: ${addr}`);

    const receiverOnEvm = (process.env.RECEIVER_ON_EVM || '0x0000000000000000000000000000000000000001').slice(2).toLowerCase();
    const amount = parseInt(process.env.CROSS_TRANSFER_AMOUNT || '100');

    // Check if user has demo tokens
    const balance = await wallet.getBalance();
    const demoTokenBalance = balance.find(b => b.unit.startsWith(contractsInfo.demoTokenPolicy));
    console.log(`Demo token balance: ${demoTokenBalance?.quantity ?? '0'}`);

    if (!demoTokenBalance || BigInt(demoTokenBalance.quantity) < BigInt(amount)) {
        console.error(`\nInsufficient demo tokens (have ${demoTokenBalance?.quantity ?? '0'}, need ${amount}).`);
        console.error('Run "yarn test:local:inbound" first to mint demo tokens via inbound flow.');
        process.exit(1);
    }

    // Create the outbound task — send demo tokens + datum to outbound demo address
    const datum = genBeneficiaryData(receiverOnEvm, amount);
    const assets = [{ unit: contractsInfo.demoTokenPolicy + defaultConfig.demoTokenName, quantity: BigInt(amount).toString(10) }];

    const tx = new Transaction({ fetcher: provider, submitter: provider, initiator: wallet })
        .sendAssets({
            address: contractsInfo.outboundDemoAddress,
            datum: { value: datum, inline: true },
        }, assets);

    const unsignedTx = await tx.build();
    const signedTx = await wallet.signTx(unsignedTx);
    const txHash = await wallet.submitTx(signedTx);
    console.log(`\nOutbound task created! TxHash: ${txHash}`);
    console.log(`  Sent to: ${contractsInfo.outboundDemoAddress}`);
    console.log(`  Amount: ${amount} (in datum)`);
    console.log(`  Receiver on EVM: 0x${receiverOnEvm}`);
    console.log('\nNow run the monitor to process it:');
    console.log('  npx ts-node src/index.ts monitor');
}

async function checkUtxos() {
    console.log('=== Checking Contract UTxOs ===\n');

    const provider = getProvider();

    const checks = [
        { name: 'Inbound Demo', address: contractsInfo.inboundDemoAddress },
        { name: 'Outbound Demo', address: contractsInfo.outboundDemoAddress },
        { name: 'XPort', address: contractsInfo.xportAddress },
        { name: 'GroupNftHolder', address: defaultConfig.GroupNftHolder },
    ];

    for (const { name, address } of checks) {
        console.log(`${name}: ${address}`);
        try {
            const utxos = await provider.fetchAddressUTxOs(address);
            if (utxos.length === 0) {
                console.log('  (no UTxOs)\n');
            } else {
                for (const utxo of utxos) {
                    const assets = utxo.output.amount.map(a => `${a.unit}:${a.quantity}`).join(', ');
                    console.log(`  ${utxo.input.txHash}#${utxo.input.outputIndex}`);
                    console.log(`    Assets: ${assets}`);
                    if (utxo.output.plutusData) {
                        console.log(`    Datum: ${utxo.output.plutusData.slice(0, 80)}...`);
                    }
                }
                console.log();
            }
        } catch (e) {
            console.log(`  (error fetching: ${e})\n`);
        }
    }

    // Also check wallet balances
    console.log('--- Wallet Balances ---');
    const seeds = [
        { name: 'Inbound Worker', seed: process.env.ACCOUNT_SEED1 },
        { name: 'Outbound Worker', seed: process.env.ACCOUNT_SEED2 },
        { name: 'User Client', seed: process.env.ACCOUNT_SEED3 },
    ];

    for (const s of seeds) {
        if (!s.seed) continue;
        try {
            const wallet = await loadWallet(s.seed);
            const addr = wallet.addresses.baseAddressBech32 ?? '';
            const balance = await wallet.getBalance();
            const ada = balance.find(b => b.unit === 'lovelace');
            console.log(`${s.name}: ${addr.slice(0, 30)}...`);
            console.log(`  ADA: ${ada ? (BigInt(ada.quantity) / 1_000_000n).toString() : '0'}`);
            const tokens = balance.filter(b => b.unit !== 'lovelace');
            for (const t of tokens) {
                console.log(`  ${t.unit.slice(0, 20)}...: ${t.quantity}`);
            }
            console.log();
        } catch (e) {
            console.log(`${s.name}: error - ${e}\n`);
        }
    }
}

async function createInboundTask() {
    console.log('=== Creating Inbound Task (simulates MPC relay) ===\n');

    const seed1 = process.env.ACCOUNT_SEED1;
    if (!seed1) { console.error('ACCOUNT_SEED1 not set'); process.exit(1); }

    const provider = getProvider();
    const wallet = await loadWallet(seed1);
    const walletAddr = wallet.addresses.baseAddressBech32 ?? '';
    console.log(`Wallet (inbound worker): ${walletAddr}`);

    // Receiver for the demo tokens (wallet 3 = user)
    const seed3 = process.env.ACCOUNT_SEED3;
    if (!seed3) { console.error('ACCOUNT_SEED3 not set'); process.exit(1); }
    const userWallet = await loadWallet(seed3);
    const receiverAddr = userWallet.addresses.baseAddressBech32 ?? '';
    console.log(`Receiver (user wallet): ${receiverAddr}`);

    const amount = parseInt(process.env.CROSS_TRANSFER_AMOUNT || '100');
    const inboundDemoAddr = contractsInfo.inboundDemoAddress;
    const inboundTokenPolicy = contractsInfo.inboundTokenPolicy;

    // Token name = inbound demo script hash (required by demo_inbound.ak:37-42)
    const inboundDemoScriptHash = resolveScriptHash(
        contractsInfo.inboundDemoScript.code,
        contractsInfo.inboundDemoScript.version
    );
    const tokenName = inboundDemoScriptHash;

    console.log(`Inbound Demo Address: ${inboundDemoAddr}`);
    console.log(`Inbound Token Policy: ${inboundTokenPolicy}`);
    console.log(`Token Name: ${tokenName}`);

    // Build CrossMsgData datum (same format as index.ts genMsgCrossData)
    const evmContract = defaultConfig.EvmContractADDRESS;
    const fromChainId = defaultConfig.EvmChainId;
    const toChainId = defaultConfig.AdaChainId;
    const fromAddress = mConStr0([evmContract]);
    const toAddress = mConStr1([mScriptAddress(inboundDemoScriptHash)]);
    const beneficiary = genBeneficiaryData(receiverAddr, amount);
    const functionCallData = mConStr0(['wmbReceiveNonEvm', serializeData(beneficiary)]);
    const datum = mConStr0(['', fromChainId, fromAddress, toChainId, toAddress, 2000000, functionCallData]);

    const useNativeScript = !!process.env.YACI_ADMIN_URL;
    const useProduction = !!process.env.INBOUND_SIGNING_KEY;

    if (useNativeScript) {
        // Yaci DevKit: use NativeScript (avoids Plutus cost model mismatch)
        console.log(`\nMinting via NativeScript (Yaci mode)...`);
        const forgingScript = ForgeScript.withOneSignature(walletAddr);
        const nativePolicyId = resolveScriptHash(forgingScript);
        const nativeTokenName = Buffer.from('InboundCheck', 'ascii').toString('hex');
        const tx = new Transaction({ initiator: wallet });
        tx.mintAsset(forgingScript, {
            assetName: nativeTokenName,
            assetQuantity: '1',
            recipient: {
                address: inboundDemoAddr,
                datum: { value: datum, inline: true },
            },
            label: '721',
        });
        const unsignedTx = await tx.build();
        const signedTx = await wallet.signTx(unsignedTx);
        const submitRes = await fetch(`${YACI_STORE_URL}/tx/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/cbor' },
            body: Buffer.from(signedTx, 'hex'),
        });
        if (!submitRes.ok) throw new Error(`Submit failed: ${await submitRes.text()}`);
        const txHash = (await submitRes.text()).replace(/"/g, '');
        console.log(`\nInbound task created! TxHash: ${txHash}`);
        console.log(`  Token: ${nativePolicyId}${nativeTokenName}`);
        console.log('\nNote: Monitor cannot process NativeScript tasks (Yaci cost model issue).');
    } else if (useProduction) {
        // Production: use InboundMintCheck spending validator with Ed25519 proof
        console.log(`\nMinting via InboundMintCheck + Ed25519 proof (production mode)...`);

        // ── 1. Load and parameterize InboundMintCheck script ─────────────────
        if (!defaultConfig.inboundMintCheck) throw new Error('inboundMintCheck validator not configured');
        const checkTokenSymbol = process.env.CHECK_TOKEN_SYMBOL;
        const checkTokenName = process.env.CHECK_TOKEN_NAME;
        if (!checkTokenSymbol || !checkTokenName) throw new Error('CHECK_TOKEN_SYMBOL and CHECK_TOKEN_NAME must be set for production mode');

        const groupNftSymbol = process.env.GROUP_NFT_SYMBOL;
        const groupNftName = process.env.GROUP_NFT_NAME;
        if (!groupNftSymbol || !groupNftName) throw new Error('GROUP_NFT_SYMBOL and GROUP_NFT_NAME must be set for production mode');

        const adminNftSymbol = process.env.ADMIN_NFT_SYMBOL;
        const adminNftName = process.env.ADMIN_NFT_NAME;
        if (!adminNftSymbol || !adminNftName) throw new Error('ADMIN_NFT_SYMBOL and ADMIN_NFT_NAME must be set for production mode');

        // Build InboundMintCheckInfo { gact: GroupAdminNFTCheckTokenInfo, mint_policy: inboundTokenPolicy }
        const groupNftInfo = mConStr0([groupNftSymbol, groupNftName]);
        const adminNftInfo = mConStr0([adminNftSymbol, adminNftName]);
        const checkTokenInfo = mConStr0([checkTokenSymbol, checkTokenName]);
        const gactParam = mConStr0([groupNftInfo, adminNftInfo, checkTokenInfo]);
        const inboundMintCheckParam = mConStr0([gactParam, inboundTokenPolicy]);
        const inboundMintCheckCbor = applyParamsToScript(
            defaultConfig.inboundMintCheck.compiledCode,
            [inboundMintCheckParam],
        );
        const inboundMintCheckScript: PlutusScript = {
            code: inboundMintCheckCbor,
            version: defaultConfig.inboundMintCheck.plutusVersion,
        };
        const inboundMintCheckHash = resolveScriptHash(inboundMintCheckCbor, defaultConfig.inboundMintCheck.plutusVersion);
        const inboundMintCheckAddress = resolvePlutusScriptAddress(inboundMintCheckScript, defaultConfig.NETWORK);
        console.log(`  InboundMintCheck hash:    ${inboundMintCheckHash}`);
        console.log(`  InboundMintCheck address: ${inboundMintCheckAddress}`);

        // stk_vh from GroupInfoParams — the check token output must go to this script address.
        // After update-gpk sets stk_vh = inboundMintCheckHash, the check token returns to
        // the InboundMintCheck address itself.
        const stkVh = process.env.STK_VH || inboundMintCheckHash;
        console.log(`  stk_vh: ${stkVh}`);

        // ── 2. Find a check token UTxO at InboundMintCheck address ───────────
        const checkTokenUnit = checkTokenSymbol + checkTokenName;
        console.log(`  Looking for check token ${checkTokenUnit} at ${inboundMintCheckAddress}...`);
        const mintCheckUtxos = await provider.fetchAddressUTxOs(inboundMintCheckAddress);
        const checkUtxo = mintCheckUtxos.find(u =>
            u.output.amount.some(a => a.unit === checkTokenUnit && BigInt(a.quantity) >= 1n)
        );
        if (!checkUtxo) {
            throw new Error(`No check token UTxO found at InboundMintCheck address (${inboundMintCheckAddress}). ` +
                `Have ${mintCheckUtxos.length} UTxOs. Ensure check tokens are minted and deposited first.`);
        }
        console.log(`  Found check UTxO: ${checkUtxo.input.txHash}#${checkUtxo.input.outputIndex}`);

        // ── 3. Get current time for TTL ──────────────────────────────────────
        // The validator compares TTL against tx validity range which is in POSIXTime (ms).
        // proof_data.ttl + 1 > tx.validity_range.upper_bound (POSIXTime)
        const latestBlock = await (provider as any).fetchBlockInfo('latest');
        const currentSlot: number = Number(latestBlock.slot);
        const nowMs = Date.now();
        const ttl = nowMs + 300_000;             // proof TTL: 5 minutes from now (POSIXTime ms)
        const txValidTo = currentSlot + 200;     // tx validity: ~3.3 min from now (slots)
        const txValidFrom = currentSlot;
        console.log(`  Current slot: ${currentSlot}, TTL (POSIXTime): ${ttl}, Tx valid to (slot): ${txValidTo}`);

        // ── 4. Construct InboundProofData ────────────────────────────────────
        // InboundProofData { cross_msg_data, ttl, mode, nonce }
        // nonce = own OutputReference (the check UTxO being spent)
        const crossMsgData = datum; // The CrossMsgData datum constructed above
        const nonce = mConStr0([checkUtxo.input.txHash, checkUtxo.input.outputIndex]);
        const proofData = mConStr0([crossMsgData, ttl, 2, nonce]); // mode = 2 (Ed25519)

        // ── 5. Sign the proof ────────────────────────────────────────────────
        const proofDataCbor = serializeData(proofData);
        const proofDataHash = sha3_256(Buffer.from(proofDataCbor, 'hex'));
        const privKey = Buffer.from(process.env.INBOUND_SIGNING_KEY!, 'hex');
        const signature = ed.sign(proofDataHash, privKey);
        const pubKey = ed.getPublicKey(privKey);
        console.log(`  Public key:  ${Buffer.from(pubKey).toString('hex')}`);
        console.log(`  Signature:   ${Buffer.from(signature).toString('hex').slice(0, 40)}...`);

        // Verify locally before submitting
        const isValid = ed.verify(signature, proofDataHash, pubKey);
        console.log(`  Local verify: ${isValid}`);
        if (!isValid) throw new Error('Ed25519 signature verification failed locally');

        // ── 6. Build redeemer ────────────────────────────────────────────────
        // InboundProof { proof_data, signature }
        const signatureHex = Buffer.from(signature).toString('hex');
        const inboundProof = mConStr0([proofData, signatureHex]);
        // InboundCheckRedeemer::InboundCheckRedeemer(InboundProof) = constructor 1
        const redeemer = mConStr1([inboundProof]);

        // ── 7. Build transaction ─────────────────────────────────────────────
        const utxos = await wallet.getUtxos();
        let collateral = (await wallet.getCollateral())[0];
        if (!collateral) {
            console.log('  Creating collateral...');
            await wallet.createCollateral();
            const deadline = Date.now() + 60_000;
            while (Date.now() < deadline) {
                const cols = await wallet.getCollateral();
                if (cols.length > 0) { collateral = cols[0]; break; }
                await new Promise(r => setTimeout(r, 5000));
            }
            if (!collateral) throw new Error('Collateral creation timed out');
        }
        const changeAddress = await wallet.getChangeAddress();

        // GroupNFTHolder UTxO for reference input (InboundMintCheck reads GroupInfoParams)
        const groupNftHolderAddr = defaultConfig.GroupNftHolder;
        const groupNftHolderUtxos = await provider.fetchAddressUTxOs(groupNftHolderAddr);
        const groupNftUnit = groupNftSymbol + groupNftName;
        const groupNftHolderUtxo = groupNftHolderUtxos.find(u =>
            u.output.amount.some(a => a.unit === groupNftUnit)
        );
        if (!groupNftHolderUtxo) {
            throw new Error(`GroupNFT holder UTxO not found at ${groupNftHolderAddr}. ` +
                `Ensure GroupNFT is deployed and GROUP_NFT_HOLDER is correct.`);
        }
        console.log(`  GroupNFT holder UTxO: ${groupNftHolderUtxo.input.txHash}#${groupNftHolderUtxo.input.outputIndex}`);

        // Derive the stk_vh script address for the check token output
        // (This is a script address with stk_vh as the payment credential)
        const stkVhAddress = resolvePlutusScriptAddress(
            { code: inboundMintCheckCbor, version: defaultConfig.inboundMintCheck.plutusVersion } as PlutusScript,
            defaultConfig.NETWORK,
        );
        // If stk_vh differs from inboundMintCheckHash, we need to compute the correct address.
        // For now, since stk_vh defaults to inboundMintCheckHash, the address is the same.
        const checkTokenOutputAddress = stkVh === inboundMintCheckHash
            ? inboundMintCheckAddress
            : (() => { throw new Error(`stk_vh (${stkVh}) != inboundMintCheckHash — custom stk_vh address derivation not yet implemented`); })();

        // Don't use evaluator — Blockfrost can't evaluate this complex multi-script tx.
        // Use manual budgets and let the node validate directly.
        const txBuilder = new MeshTxBuilder({ fetcher: provider, submitter: provider });

        await txBuilder
            // Spend the check token UTxO at InboundMintCheck (Plutus V3 spending script)
            .spendingPlutusScript(defaultConfig.inboundMintCheck.plutusVersion)
            .txIn(
                checkUtxo.input.txHash,
                checkUtxo.input.outputIndex,
                checkUtxo.output.amount,
                checkUtxo.output.address,
            )
            .spendingReferenceTxInInlineDatumPresent()
            .spendingReferenceTxInRedeemerValue(redeemer, undefined, { mem: 8_000_000, steps: 5_000_000_000 })
            .txInScript(inboundMintCheckCbor)
            // Mint 1 inbound token
            .mintPlutusScript(contractsInfo.inboundTokenScript.version)
            .mint('1', inboundTokenPolicy, tokenName)
            .mintingScript(contractsInfo.inboundTokenScript.code)
            .mintRedeemerValue(mConStr0([]), undefined, { mem: 4_000_000, steps: 2_000_000_000 })
            // Output: inbound token + CrossMsgData datum at inbound demo address
            .txOut(inboundDemoAddr, [
                { unit: inboundTokenPolicy + tokenName, quantity: '1' },
                { unit: 'lovelace', quantity: '5000000' },
            ])
            .txOutInlineDatumValue(datum)
            // Output: check token back to stk_vh address (single-asset: check token + min ADA)
            .txOut(checkTokenOutputAddress, [
                { unit: checkTokenUnit, quantity: '1' },
                { unit: 'lovelace', quantity: '5000000' },
            ])
            .txOutInlineDatumValue(mConStr0([0])) // Unit datum (NonsenseDatum or similar)
            // Reference input: GroupNFTHolder (for GroupInfoParams)
            .readOnlyTxInReference(
                groupNftHolderUtxo.input.txHash,
                groupNftHolderUtxo.input.outputIndex,
            )
            // Validity range: [currentSlot, txValidTo)
            .invalidBefore(txValidFrom)
            .invalidHereafter(txValidTo)
            // Collateral
            .txInCollateral(
                collateral.input.txHash,
                collateral.input.outputIndex,
                collateral.output.amount,
                collateral.output.address,
            )
            .changeAddress(changeAddress)
            .selectUtxosFrom(utxos)
            .complete();

        const unsignedTx = txBuilder.txHex;
        const signedTx = await wallet.signTx(unsignedTx);
        const txHash = await wallet.submitTx(signedTx);
        console.log(`\nInbound task created! TxHash: ${txHash}`);
        console.log(`  Token: ${inboundTokenPolicy}${tokenName}`);
        console.log(`  Check token returned to: ${checkTokenOutputAddress}`);
        console.log('\nThe monitor should pick this up and process it.');
    } else {
        // Preprod/testnet: use Plutus V2 always-true minting policy
        console.log(`\nMinting via Plutus V2 (preprod mode)...`);
        const txBuilder = new MeshTxBuilder({ fetcher: provider, submitter: provider, evaluator: provider });
        const utxos = await wallet.getUtxos();
        let collateral = (await wallet.getCollateral())[0];
        if (!collateral) {
            console.log('  Creating collateral...');
            await wallet.createCollateral();
            const deadline = Date.now() + 60_000;
            while (Date.now() < deadline) {
                const cols = await wallet.getCollateral();
                if (cols.length > 0) { collateral = cols[0]; break; }
                await new Promise(r => setTimeout(r, 5000));
            }
            if (!collateral) throw new Error('Collateral creation timed out');
        }
        const changeAddress = await wallet.getChangeAddress();

        await txBuilder
            .mintPlutusScript(contractsInfo.inboundTokenScript.version)
            .mint('1', inboundTokenPolicy, tokenName)
            .mintingScript(contractsInfo.inboundTokenScript.code)
            .mintRedeemerValue(mConStr0([]))
            .txOut(inboundDemoAddr, [
                { unit: inboundTokenPolicy + tokenName, quantity: '1' },
                { unit: 'lovelace', quantity: '5000000' },
            ])
            .txOutInlineDatumValue(datum)
            .txInCollateral(
                collateral.input.txHash,
                collateral.input.outputIndex,
                collateral.output.amount,
                collateral.output.address
            )
            .changeAddress(changeAddress)
            .selectUtxosFrom(utxos)
            .complete();

        const unsignedTx = txBuilder.txHex;
        const signedTx = await wallet.signTx(unsignedTx);
        const txHash = await wallet.submitTx(signedTx);
        console.log(`\nInbound task created! TxHash: ${txHash}`);
        console.log(`  Token: ${inboundTokenPolicy}${tokenName}`);
        console.log('\nThe monitor should pick this up and process it.');
    }

    console.log(`  Amount in datum: ${amount}`);
    console.log(`  Receiver: ${receiverAddr}`);
}

// CLI
const command = process.argv[2];
switch (command) {
    case 'outbound':
        createOutboundTask().catch(e => { console.error(e); process.exit(1); });
        break;
    case 'inbound':
        createInboundTask().catch(e => { console.error(e); process.exit(1); });
        break;
    case 'check':
        checkUtxos().catch(e => { console.error(e); process.exit(1); });
        break;
    default:
        console.log('Usage: npx ts-node scripts/test-local.ts <command>');
        console.log('Commands:');
        console.log('  inbound   — Create an inbound task (simulates MPC relay, mints test check token)');
        console.log('  outbound  — Create an outbound task (Cardano → EVM)');
        console.log('  check     — Inspect UTxOs at contract addresses');
        break;
}
