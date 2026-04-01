// Load .env before any other imports so config.ts sees the env vars
import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config({ path: path.join(__dirname, '../', '.env') });

import { BlockfrostProvider, MeshTxBuilder, MeshWallet, Output, resolveScriptHash, mConStr0, Transaction, serializeData } from '@meshsdk/core';
import { mConStr1, mScriptAddress, UTxO } from "@meshsdk/common";
import contractsInfo from "./scripts";
import { defaultConfig } from "./config";
import { getBeneficiaryFromCbor, getMsgCrossDataFromCbor, bech32AddressToMeshData, genBeneficiaryData, TaskPool } from './datum';
import { sleep, withTimeout } from './utils';

const receiverOnAda = process.env.RECEIVER_ON_ADA || 'addr_test1qpm0q3dmc0cq4ea75dum0dgpz4x5jsdf6jk0we04yktpuxnk7pzmhslsptnmagmek76sz92df9q6n49v7ajl2fvkrcdq9semsd';
const receiverOnEvm = (process.env.RECEIVER_ON_EVM || '0x1d1e18e1a484d0a10623661546ba97DEfAB7a7AE').slice(2).toLowerCase();
const CROSS_TRANSFER_AMOUNT = parseInt(process.env.CROSS_TRANSFER_AMOUNT || '100');

console.log(`inboundDemoScript address: ${contractsInfo.inboundDemoAddress}`);
console.log(`inboundTokenScript policy: ${contractsInfo.inboundTokenPolicy}`);

console.log(`outboundDemoScript address: ${contractsInfo.outboundDemoAddress}`);
console.log(`outboundTokenScript policy: ${contractsInfo.outboundTokenPolicy}`);
console.log(`xportScript address: ${contractsInfo.xportAddress}`);

console.log(`demoTokenScript policy: ${contractsInfo.demoTokenPolicy}`);

if (!process.env.BLOCKFROST_API_KEY) {
    throw new Error('BLOCKFROST_API_KEY environment variable is not set');
}
const provider = new BlockfrostProvider(process.env.BLOCKFROST_API_KEY);


interface TransferInfo {
    receiver: string;
    amount: bigint;
}
interface FunctionCallData {
    functionName: string;
    functionArgs: TransferInfo;
}
interface TaskInfo {
    id: string;
    fromChainId: bigint;
    fromContract: string;
    toChainId: bigint;
    targetContract: string;
    gasLimit: bigint
    functionCallData: FunctionCallData;
}

enum TaskType {
    INBOUND = 'inbound',
    OUTBOUND = 'outbound'
};

enum TaskStatus {
    READY = 'ready',
    DONE = 'done'
}

class Task implements TaskInfo {
    readonly id: string;
    readonly fromChainId: bigint;
    readonly fromContract: string;
    readonly toChainId: bigint;
    readonly targetContract: string;
    readonly gasLimit: bigint;
    readonly functionCallData: FunctionCallData;

    readonly taskType: TaskType;
    readonly utxo: UTxO;
    status: TaskStatus;
    finishedTx?: string;

    constructor(utxo: UTxO) {
        if (!utxo.output.plutusData) throw 'utxo is not a task';
        if (utxo.output.amount.find((item) => (item.unit.indexOf(contractsInfo.inboundTokenPolicy) == 0))) {
            this.taskType = TaskType.INBOUND;
            const msgCrossData = getMsgCrossDataFromCbor(utxo.output.plutusData, defaultConfig.NETWORK);
            this.id = Buffer.from(msgCrossData.msgId,'hex').toString('ascii');
            this.fromChainId = msgCrossData.fromChainId;
            this.fromContract = msgCrossData.fromContract;
            this.toChainId = msgCrossData.toChainId;
            this.targetContract = msgCrossData.targetContract;
            this.gasLimit = msgCrossData.gasLimit;
            this.functionCallData = msgCrossData.functionCallData;
        } else {
            const beneficiary = getBeneficiaryFromCbor(utxo.output.plutusData, defaultConfig.NETWORK);
            this.taskType = TaskType.OUTBOUND;
            this.id = utxo.input.txHash + '#' + utxo.input.outputIndex;
            this.fromChainId = BigInt(defaultConfig.AdaChainId);
            this.fromContract = contractsInfo.outboundDemoAddress;
            this.toChainId = BigInt(defaultConfig.EvmChainId);
            this.targetContract = defaultConfig.EvmContractADDRESS;
            this.gasLimit = 2000000n;
            this.functionCallData = {
                functionName: 'wmbReceiveNonEvm',
                functionArgs: { receiver: beneficiary.receiver, amount: beneficiary.amount }
            };

            const asset = utxo.output.amount.find((item) => (item.unit.indexOf(contractsInfo.demoTokenPolicy) == 0));
            if (!asset || BigInt(asset.quantity) < BigInt(beneficiary.amount)) { throw 'utxo is not a task,not enough token' };
        }

        this.utxo = utxo;
        this.status = TaskStatus.READY;
    }

}

let inboundTaskPool: TaskPool<Task> = new TaskPool();
let outboundTaskPool: TaskPool<Task> = new TaskPool();
let walletInbound: MeshWallet;
let walletOutbound: MeshWallet;
let walletUser: MeshWallet;
let badTaskUtxos = new Map<string, number>;
async function fetchTask(provider: BlockfrostProvider, taskType: TaskType) {
    const taskContractAddress = taskType == TaskType.INBOUND ? contractsInfo.inboundDemoAddress : contractsInfo.outboundDemoAddress;
    let taskPool = taskType == TaskType.INBOUND ? inboundTaskPool : outboundTaskPool;
    const utxos = await provider.fetchAddressUTxOs(taskContractAddress);
    
    utxos.map(utxo => {
        const key = (utxo.input.txHash+'#'+utxo.input.outputIndex).toLowerCase();
        if (badTaskUtxos.has(key) && (badTaskUtxos.get(key) ?? 0) >= 1) return;
        try {
            const task = new Task(utxo);
            if (taskPool.isExist(task.id)) {
                console.log(`${taskType} task ${task.id} is exist,ignoral`);
                return;
            }
            if (task.status === TaskStatus.READY) {
                taskPool.push(task);
            }

            console.log(`add ${taskType} task : [${task.id}], current task pool size: ${taskPool.size()} receiver: ${task.functionCallData.functionArgs.receiver}, amount: ${task.functionCallData.functionArgs.amount}`);
        } catch (error) {
            const key = (utxo.input.txHash+'#'+utxo.input.outputIndex).toLowerCase();
            badTaskUtxos.set(key, (badTaskUtxos.get(key) ?? 0) + 1);
            console.log(`[${key}]${utxo.input.txHash}#${utxo.input.outputIndex} is not a valid ${taskType} task, failed ${badTaskUtxos.get(key)} times`);
            console.error(error);
        }
    });
}

async function sendTxDoInboundTask(wallet: MeshWallet, task: Task): Promise<string> {

    const txBuilder = new MeshTxBuilder({ fetcher: provider, submitter: provider, evaluator: provider });

    let assets = [{
        unit: contractsInfo.demoTokenPolicy + defaultConfig.demoTokenName,
        quantity: BigInt(task.functionCallData.functionArgs.amount).toString(10)
    }]

    const minAda = txBuilder.calculateMinLovelaceForOutput({
        address: task.functionCallData.functionArgs.receiver,
        amount: assets
    });
    assets.push({ unit: 'lovelace', quantity: minAda.toString(10) });
    const utxos = await wallet.getUtxos();
    const collateral = (await wallet.getCollateral())[0];
    const inboundTokenAssetOfUtxo = task.utxo.output.amount.find(asset => asset.unit.indexOf(contractsInfo.inboundTokenPolicy) == 0);
    if (!inboundTokenAssetOfUtxo) throw new Error('No inbound token found in task UTxO');
    const inboundTokenPolicy = inboundTokenAssetOfUtxo.unit.slice(0, 56);
    const inboundTokenName = inboundTokenAssetOfUtxo.unit.slice(56);
    const changeAddress = await wallet.getChangeAddress();
    await txBuilder
        .spendingPlutusScript(contractsInfo.inboundDemoScript.version)
        .txIn(task.utxo.input.txHash, task.utxo.input.outputIndex, task.utxo.output.amount, task.utxo.output.address, 0)
        .spendingReferenceTxInInlineDatumPresent()
        .spendingReferenceTxInRedeemerValue(mConStr0([contractsInfo.demoTokenPolicy, defaultConfig.EvmContractADDRESS])).txInScript(contractsInfo.inboundDemoScript.code)

        .mintPlutusScript(contractsInfo.inboundTokenScript.version)
        .mint('-' + inboundTokenAssetOfUtxo.quantity, inboundTokenPolicy, inboundTokenName)
        .mintingScript(contractsInfo.inboundTokenScript.code)
        .mintRedeemerValue(mConStr0([]))

        .mintPlutusScript(contractsInfo.demoTokenScript.version)
        .mint(BigInt(task.functionCallData.functionArgs.amount).toString(10), contractsInfo.demoTokenPolicy, defaultConfig.demoTokenName)
        .mintingScript(contractsInfo.demoTokenScript.code)
        .mintRedeemerValue(mConStr0([]))
        .txOut(task.functionCallData.functionArgs.receiver, assets)
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
    return txHash;
}

async function doTask(taskType: TaskType) {

    let taskPool = taskType == TaskType.INBOUND ? inboundTaskPool : outboundTaskPool;
    let task = taskPool.popTask();
    const wallet = taskType == TaskType.INBOUND ? walletInbound : walletOutbound;
    while (task) {
        console.log(`Begin to excute ${task.taskType} task:[${task.id}] receiver:${task.functionCallData.functionArgs.receiver} amount:${task.functionCallData.functionArgs.amount}`);
        let txHash: string | undefined;
        try {
            switch (task.taskType) {
                case TaskType.INBOUND: {
                    txHash = await sendTxDoInboundTask(wallet, task);
                    break;
                }
                case TaskType.OUTBOUND: {
                    txHash = await sendTxDoOutboundTask(wallet, task);
                    break;
                }
                default: break;
            }
        } catch (error) {
            console.error(`send Tx failed for do ${taskType} task ${task.id}, utxo =${ task.utxo.input.txHash}#${task.utxo.input.outputIndex}`, error);

            const key = (task.utxo.input.txHash+'#'+task.utxo.input.outputIndex).toLowerCase();
            badTaskUtxos.set(key, (badTaskUtxos.get(key) ?? 0) + 1);
        }


        if (txHash) {
            const confirmTx = async (txHash: string) => {
                while (true) {
                    try {
                        const addrs = wallet.getAddresses();
                        const worker = addrs.baseAddressBech32 ?? addrs.enterpriseAddressBech32 ?? '';
                        if (!worker) throw new Error('Wallet has no address');
                        const utxos = await provider.fetchAddressUTxOs(worker);
                        if(utxos.findIndex(utxo=> utxo.input.txHash == txHash) >= 0) {
                            return true;
                        }
                    } catch (error) {
                    }

                    await sleep(5000);
                }

            }
            task.finishedTx = txHash;
            task.status = TaskStatus.DONE;
            console.log(`${task.taskType} task [${task.id}] has done successfully at Tx: ${txHash}`);
            taskPool.removeDone(task.id);

            try {
                await withTimeout(60000, confirmTx(txHash));
                console.log(`${task.taskType} task [${task.id}] has confirmed successfully at Tx: ${txHash}`);
            } catch (e) {
                console.log(`confirm ${task.taskType} task [${task.id}] timeout, force delete task`);
            }
        }

        task = taskPool.popTask();
    }

}

function genMsgCrossData(to: string, amount: string | bigint | number, direction: TaskType) {
    const script = direction == TaskType.INBOUND ? contractsInfo.inboundDemoScript : contractsInfo.outboundDemoScript;
    const scriptHash = resolveScriptHash(script.code, script.version);
    const taskId = '';
    const fromChainId = direction == TaskType.INBOUND ? defaultConfig.EvmChainId : defaultConfig.AdaChainId;
    const fromAddress = direction == TaskType.OUTBOUND ? mConStr1([mScriptAddress(scriptHash)]) : mConStr0([defaultConfig.EvmContractADDRESS]);
    const toChainId = direction == TaskType.INBOUND ? defaultConfig.AdaChainId : defaultConfig.EvmChainId;

    const toAddress = direction == TaskType.INBOUND ? mConStr1([mScriptAddress(scriptHash)]) : mConStr0([defaultConfig.EvmContractADDRESS]);
    const gasLimit = 2000000;

    const tmpCallData = mConStr0(['wmbReceiveNonEvm', serializeData(genBeneficiaryData(to, amount))]);
    return mConStr0([taskId, fromChainId, fromAddress, toChainId, toAddress, gasLimit, tmpCallData]);
}

async function createInboundTask(to: string, amount: string | bigint | number) {
    const utxos = await walletInbound.getUtxos();
    const txBuilder = new MeshTxBuilder({ fetcher: provider, submitter: provider, evaluator: provider });

    let assets = [{ unit: 'lovelace', quantity: '1200000' }];
    const datum = genMsgCrossData(to, amount, TaskType.INBOUND);
    let outputOfTarget: Output = {
        address: contractsInfo.inboundDemoAddress,
        amount: assets,
        datum: {
            type: 'Inline',
            data: {
                type: "Mesh",
                content: datum
            }
        }
    }


    const minAda = txBuilder.calculateMinLovelaceForOutput(outputOfTarget);
    assets.push({ unit: 'lovelace', quantity: minAda.toString(10) });

    const tx = new Transaction({ initiator: walletInbound })
        .sendLovelace({
            address: contractsInfo.inboundDemoAddress,
            datum: { value: datum, inline: true },
        }, minAda.toString(10));
    const unsignedTx = await tx.build();
    const signedTx = await walletInbound.signTx(unsignedTx);
    const txHash = await walletInbound.submitTx(signedTx);
    console.log(`create Inbound Task tx: ${txHash}`);
}


async function createOutboundTask(wallet: MeshWallet, to: string, amount: string | bigint | number) {
    let assets = [{ unit: contractsInfo.demoTokenPolicy + defaultConfig.demoTokenName, quantity: BigInt(amount).toString(10) }];
    const datum = genBeneficiaryData(to, amount);

    const tx = new Transaction({ fetcher: provider, submitter: provider, initiator: wallet })
        .sendAssets({
            address: contractsInfo.outboundDemoAddress,
            datum: { value: datum, inline: true },
        }, assets);
    const unsignedTx = await tx.build();
    const signedTx = await wallet.signTx(unsignedTx);
    const txHash = await wallet.submitTx(signedTx);
    console.log(`create outbound Task tx: ${txHash}`);
    return txHash;
}

async function sendTxDoOutboundTask(wallet: MeshWallet, task: Task) {

    let outboundTaskUtxo = task.utxo;
    const beneficiary = task.functionCallData.functionArgs;

    const asset = outboundTaskUtxo.output.amount.find((item) => (item.unit.indexOf(contractsInfo.demoTokenPolicy) == 0));
    if (!asset || BigInt(asset.quantity) < BigInt(beneficiary.amount)) { throw 'not enough token' };

    const txBuilder = new MeshTxBuilder({ fetcher: provider, submitter: provider, evaluator: provider });
    let assetsOfOutboundToken = [{
        unit: contractsInfo.outboundTokenPolicy + defaultConfig.OUTBOUND_TOKEN_NAME,
        quantity: '1'
    }];

    const groupNftUtxos = await provider.fetchAddressUTxOs(defaultConfig.GroupNftHolder);
    if (!groupNftUtxos || groupNftUtxos.length === 0) {
        throw new Error(`No UTxOs found at GroupNftHolder address: ${defaultConfig.GroupNftHolder}`);
    }
    const groupNftUtxo = groupNftUtxos[0];


    const outboundDatum = genMsgCrossData(beneficiary.receiver, beneficiary.amount, TaskType.OUTBOUND);
    const minAda = txBuilder.calculateMinLovelaceForOutput({
        address: contractsInfo.xportAddress,
        amount: assetsOfOutboundToken,
        datum: {
            type: 'Inline',
            data: {
                type: "Mesh",
                content: outboundDatum
            }
        }
    });
    assetsOfOutboundToken.push({ unit: 'lovelace', quantity: minAda.toString(10) });
    const utxos = await wallet.getUtxos();
    const collateral = (await wallet.getCollateral())[0];
    const outboundRedeemer = mConStr0([contractsInfo.demoTokenPolicy, defaultConfig.demoTokenName, bech32AddressToMeshData(contractsInfo.xportAddress),defaultConfig.EvmContractADDRESS]);

    const changeAddress = await wallet.getChangeAddress();
    await txBuilder
        .spendingPlutusScript(contractsInfo.outboundDemoScript.version)
        .txIn(outboundTaskUtxo.input.txHash, outboundTaskUtxo.input.outputIndex, outboundTaskUtxo.output.amount, outboundTaskUtxo.output.address, 0)
        .spendingReferenceTxInInlineDatumPresent()
        .spendingReferenceTxInRedeemerValue(outboundRedeemer).txInScript(contractsInfo.outboundDemoScript.code)
        .mintPlutusScript(contractsInfo.demoTokenScript.version)
        .mint('-' + BigInt(beneficiary.amount).toString(10), contractsInfo.demoTokenPolicy, defaultConfig.demoTokenName)
        .mintingScript(contractsInfo.demoTokenScript.code)
        .mintRedeemerValue(mConStr0([]))
        .mintPlutusScript(contractsInfo.outboundTokenScript.version)
        .mint('1', contractsInfo.outboundTokenPolicy, defaultConfig.OUTBOUND_TOKEN_NAME)
        .mintingScript(contractsInfo.outboundTokenScript.code)
        .mintRedeemerValue(mConStr0([]))
        .txOut(contractsInfo.xportAddress, assetsOfOutboundToken)
        .txOutInlineDatumValue(outboundDatum)
        .readOnlyTxInReference(groupNftUtxo.input.txHash, groupNftUtxo.input.outputIndex)
        .txInCollateral(
            collateral.input.txHash,
            collateral.input.outputIndex,
            collateral.output.amount,
            collateral.output.address
        )
        .changeAddress(changeAddress).selectUtxosFrom(utxos)
        .complete();
    const unsignedTx = txBuilder.txHex;
    const signedTx = await wallet.signTx(unsignedTx);
    const txHash = await wallet.submitTx(signedTx);
    return txHash;
}


async function monitor(taskType: TaskType) {
    while (1) {
        await fetchTask(provider, taskType);
        await doTask(taskType);
        await sleep(5000);
    }
}


async function walletReady(wallet: MeshWallet) {
    let collateralUtxo = await wallet.getCollateral();
    if (collateralUtxo.length === 0) {
        console.log(`wallet ${wallet.getAddresses().baseAddressBech32} has no collateral utxo, create collateral utxo auto ...`);
        await wallet.createCollateral();
        const waitFetchCollateral = async () => {
            while (collateralUtxo.length === 0) {
                collateralUtxo = await wallet.getCollateral();
                await sleep(5000);
            }

        }
        await withTimeout(30000, waitFetchCollateral());
        console.log('create collateral utxo success:', collateralUtxo[0]);
    }
    const balance = await wallet.getBalance();

    console.log('balance:');
    balance.forEach((item) => {
        console.log('    ', item.unit, item.quantity);
    });
    console.log('collateral utxo:');
    collateralUtxo.forEach(utxo => {
        console.log('    ', utxo.input.txHash, utxo.input.outputIndex, JSON.stringify(utxo.output.amount), utxo.output.address);
    })
}
async function loadWallet(seed: string) {

    let wallet = new MeshWallet({
        networkId: defaultConfig.NETWORK ? 1 : 0, // 0: testnet, 1: mainnet
        fetcher: provider,
        submitter: provider,
        key: {
            type: 'cli',
            payment: seed,
        },
    });

    await wallet.init();
    console.log('wallet address:',wallet.addresses.baseAddressBech32);

    return wallet;
}


export const userCossChainTransfer = async () => {
    walletUser = await loadWallet('5820' + process.env.ACCOUNT_SEED3);
    return await createOutboundTask(walletUser, receiverOnEvm, CROSS_TRANSFER_AMOUNT);
}


import { Command } from 'commander';
const program = new Command();

program.name('msg-agent').description('demo agent for msg cross chain').version('1.0.0');

program
    .command('monitor')
    .description('Start monitoring inbound outbound tasks and processing them')
    .action(async () => {
        walletInbound = await loadWallet('5820' + process.env.ACCOUNT_SEED1);
        console.log('wallet1 address:', walletInbound.addresses.baseAddressBech32);
        walletOutbound = await loadWallet('5820' + process.env.ACCOUNT_SEED2);
        console.log('wallet2 address:', walletOutbound.addresses.baseAddressBech32);
        await walletReady(walletInbound);
        await walletReady(walletOutbound);
        await Promise.all([
            monitor(TaskType.INBOUND).catch((err) => {
                console.error('Inbound monitor failed:', err);
                process.exit(1);
            }),
            monitor(TaskType.OUTBOUND).catch((err) => {
                console.error('Outbound monitor failed:', err);
                process.exit(1);
            }),
        ]);
    });

program
    .command('client')
    .description('cross-transfer demoToken')
    .action(async () => {
        walletUser = await loadWallet('5820' + process.env.ACCOUNT_SEED3);
        await createOutboundTask(walletUser, receiverOnEvm, CROSS_TRANSFER_AMOUNT);
    });

program.parse(process.argv);