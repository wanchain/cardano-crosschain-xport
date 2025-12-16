/*
 * @Author: liulin blue-sky-dl5@163.com
 * @Date: 2025-12-02 11:12:29
 * @LastEditors: liulin blue-sky-dl5@163.com
 * @LastEditTime: 2025-12-16 21:02:11
 * @FilePath: /msg-demo-project/msg-agent/index.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import { BlockfrostProvider, MeshTxBuilder, MeshWallet, UtxoSelection, deserializeDatum, serializeAddressObj, serializePlutusScript, policyId, AssetFingerprint, Asset, Output, resolveScriptHash, mConStr0, deserializeAddress, Transaction, MintingBlueprint, Mint, Wallet, TxParser, serializeData, OgmiosProvider } from '@meshsdk/core';
import { conStr0, mConStr1, mMaybeStakingHash, mPlutusBSArrayToString, mPubKeyAddress, mScriptAddress, stringToHex, UTxO } from "@meshsdk/common";
import contractsInfo from "./scripts";
import dotenv from 'dotenv';
import path from 'node:path';
import { defaultConfig } from "./config";
import fs from 'fs';


// import { fileURLToPath } from 'node:url';
// const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../', '.env') });

// const provider = new BlockfrostProvider(process.env.BLOCKFROST_API_KEY);

// provider.fetchAddressUTxOs('addr_test1qz6twkzgss75sk379u0e27phvwhmtqqfuhl5gnx7rh7nux2xg4uwrhx9t58far8hp3a06hfdfzlsxgfrzqv5ryc78e4s4dwh26')
// const outboundTokenScriptInfo = getOutboundTokenScript();
// const inboundDemoScriptInfo = getInboundDemoScript();
// const demoTokenScriptInfo = getDemoTokenSCript();
// const outboundDemoScriptInof = getOutboundDemoScript();


const receiverOnAda = 'addr_test1qpm0q3dmc0cq4ea75dum0dgpz4x5jsdf6jk0we04yktpuxnk7pzmhslsptnmagmek76sz92df9q6n49v7ajl2fvkrcdq9semsd';
const receiverOnEvm = '0x1d1e18e1a484d0a10623661546ba97DEfAB7a7AE'.toLowerCase();
const CROSS_TRANSFER_AMOUNT = 1000;

console.log(`inboundDemoScript address: ${contractsInfo.inboundDemoAddress}`);
console.log(`inboundTokenScript policy: ${contractsInfo.inboundTokenPolicy}`);

console.log(`outboundDemoScript address: ${contractsInfo.outboundDemoAddress}`);
console.log(`outboundTokenScript policy: ${contractsInfo.outboundTokenPolicy}`);
console.log(`xportScipt address: ${contractsInfo.xportAddress}`);

console.log(`demoTokenScrip policy: ${contractsInfo.demoTokenPolicy}`);



// console.log(`inboundDemoScript: ${inboundDemoScriptInfo.script.code}`);
// if(!process.env.BLOCKFROST_API_KEY) throw 'BLOCKFROST_API_KEY is not set'
const provider = new BlockfrostProvider(process.env.BLOCKFROST_API_KEY ? process.env.BLOCKFROST_API_KEY : '');
const ogmiosUrl = 'https://ogmios1uxnqpx0u6erjzpcfdtk.cardano-preprod-v6.ogmios-m1.dmtr.host';
// const ogmiosUrl = '52.13.9.234:1337';
const ogmios = new OgmiosProvider(ogmiosUrl)

interface TransferInfo {
    receiver: string;
    amount: bigint;
}
interface FuctionCallData {
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
    functionCallData: FuctionCallData;
}

enum TaskType {
    INBOUND = 'inbound',
    OUTBOUND = 'outbound'
};

enum TaskStatus {
    IDLE = 'idle',
    PENDING = 'pending',
    SUCCESS = 'success',
    FAILED = 'failed'
}

console.log('--[', serializeData(genBeneficiaryData(receiverOnAda, 10000)), ']');
const test_datum = serializeData(genBeneficiaryData(receiverOnEvm, 10000))
console.log('--[', test_datum, ']');
console.log('--[', getBeneficiaryFromCbor(test_datum), ']');
class Task implements TaskInfo {
    readonly id: string;
    readonly fromChainId: bigint;
    readonly fromContract: string;
    readonly toChainId: bigint;
    readonly targetContract: string;
    readonly gasLimit: bigint;
    readonly functionCallData: FuctionCallData;

    readonly taskType: TaskType;
    readonly utxo: UTxO;
    status: TaskStatus;
    finishedTx?: string;

    constructor(utxo: UTxO) {
        if (!utxo.output.plutusData) throw 'utxo is not a task';
        if (utxo.output.amount.find((item) => (item.unit.indexOf(contractsInfo.inboundTokenPolicy) == 0))) {
            this.taskType = TaskType.INBOUND;
            const msgCrossData = getMsgCrossDataFromCbor(utxo.output.plutusData);
            this.id = msgCrossData.msgId;
            this.fromChainId = msgCrossData.fromChainId;
            this.fromContract = msgCrossData.fromContract;
            this.toChainId = msgCrossData.toChainId;
            this.targetContract = msgCrossData.targetContract;
            this.gasLimit = msgCrossData.gasLimit;
            this.functionCallData = msgCrossData.functionCallData;
        } else {
            const beneficiary = getBeneficiaryFromCbor(utxo.output.plutusData);
            this.taskType = TaskType.OUTBOUND;
            this.id = '';
            this.fromChainId = BigInt(defaultConfig.AdaChainId);
            this.fromContract = contractsInfo.outboundDemoAddress;
            this.toChainId = BigInt(defaultConfig.EvmChainId);
            this.targetContract = defaultConfig.EvmContractADDRESS
            this.gasLimit = 2000000n;
            this.functionCallData = {
                functionName: 'wmbReceive',
                functionArgs: { receiver: beneficiary.receiver, amount: beneficiary.amount }
            };
            
            const asset = utxo.output.amount.find((item) => (item.unit.indexOf(contractsInfo.demoTokenPolicy) == 0));
            if (!asset || BigInt(asset.quantity) < BigInt(beneficiary.amount)) { throw 'utxo is not a task,not enough token' };
        }



        // if (!this.taskType) throw 'utxo is not a task';
        // console.log('222222222',datum.fields[4])
        // this.functionCallData = {
        //     functionName: tmpCallData.fields[0].bytes,
        //     functionArgs: { receiver: serializeAddressObj(tmpCallData.fields[1].fields[0], 0), amount: tmpCallData.fields[1].fields[1].int }
        // }
        this.utxo = utxo;
        this.status = TaskStatus.IDLE;
    }

}

class TaskPool {
    private taskMap: Map<string, Task>;
    private taskQueue: Task[];

    constructor() {
        this.taskMap = new Map();
        this.taskQueue = [];
    }

    push(task: Task) {
        if (this.taskMap.has(task.id)) return;
        this.taskMap.set(task.id, task);
        this.taskQueue.push(task);
    }

    isExist(taskId: string) {
        return this.taskMap.has(taskId);
    }

    size() {
        return this.taskQueue.length;
    }

    popTask(n: number): Task[] {
        if (this.taskQueue.length == 0) return [];
        const tasks: Task[] = [];
        this.taskQueue.forEach(task => {
            if (task.status == TaskStatus.IDLE) {
                task.status = TaskStatus.PENDING;
                tasks.push(task);
                if (tasks.length == n) return tasks;
            }
        });
        return tasks;
    }

    removeDone() {
        let taskIds = [];
        for (const [taskId, task] of this.taskMap) {
            if (task.status == TaskStatus.SUCCESS) {
                taskIds.push(taskId);
            }
        }

        if (taskIds.length) console.log(`remove finished task(${taskIds.length}):${taskIds}`);
        for (let index = 0; index < taskIds.length; index++) {
            const taskId = taskIds[index];
            this.taskMap.delete(taskId);
        }

        this.taskQueue = [];
        this.taskMap.forEach(task => {
            this.taskQueue.push(task);
        })
    }
}

let inboundTaskPool: TaskPool = new TaskPool();
let outboundTaskPool: TaskPool = new TaskPool();
let walletInbound: MeshWallet;
let walletOutbound: MeshWallet;
let walletUser: MeshWallet;
// class WalletPool
async function fetchTask(provider: BlockfrostProvider, taskType: TaskType) {
    // await createInboundTask(receiverOnAda, CROSS_TRANSFER_AMOUNT);
    const taskContractAddress = taskType == TaskType.INBOUND ? contractsInfo.inboundDemoAddress : contractsInfo.outboundDemoAddress;
    let taskPool = taskType == TaskType.INBOUND ? inboundTaskPool : outboundTaskPool;
    const utxos = await provider.fetchAddressUTxOs(taskContractAddress);
    utxos.map(utxo => {
        // if (utxo.input.txHash != '8c181ac3a93e4beadb3fac33bc79e60c8986a43aafa29eead9f25aef5851b75a') return;
        try {
            const task = new Task(utxo);
            if (taskPool.isExist(task.id)) {
                console.log(`${taskType} task ${task.id} is exist,ignoral`);
                return;
            }
            taskPool.push(task);
            console.log(`add ${taskType} task : ${task.id}, current task pool size: ${taskPool.size()} receiver: ${task.functionCallData.functionArgs.receiver}, amount: ${task.functionCallData.functionArgs.amount}`);
        } catch (error) {
            console.log(`${utxo.input.txHash}#${utxo.input.outputIndex} is not a valid ${taskType} task`);
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
    console.log(JSON.stringify(collateral));
    const inboundTokenAssetOfUtxo = task.utxo.output.amount.find(asset => asset.unit.indexOf(contractsInfo.inboundTokenPolicy) == 0);
    const inboundTokenPolicy = inboundTokenAssetOfUtxo?.unit.slice(0, 56);
    const inboundTokenName = inboundTokenAssetOfUtxo?.unit.slice(56);
    const changeAddress = await wallet.getChangeAddress();
    await txBuilder
        .spendingPlutusScript(contractsInfo.inboundDemoScript.version)
        .txIn(task.utxo.input.txHash, task.utxo.input.outputIndex, task.utxo.output.amount, task.utxo.output.address, 0)
        .spendingReferenceTxInInlineDatumPresent()
        .spendingReferenceTxInRedeemerValue(contractsInfo.demoTokenPolicy).txInScript(contractsInfo.inboundDemoScript.code)

        // .mintPlutusScript(contractsInfo.inboundTokenScript.version)
        // .mint('-' + inboundTokenAssetOfUtxo.quantity, inboundTokenPolicy, inboundTokenName)
        // .mintingScript(contractsInfo.inboundTokenScript.code)
        // .mintRedeemerValue(mConStr0([]))

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
    // const exUnit = await provider.evaluateTx(signedTx);
    // console.log('signed tx:', signedTx);
    // const aa = new TxParser(txBuilder.serializer, provider);
    // const bb = aa.toTester().errors();
    // console.log('======>',bb);
    // fs.writeFileSync('./inbound.tx', signedTx);
    const txHash = await wallet.submitTx(signedTx);
    return txHash;
}

async function doTask(n: number = 1) {
    const tasks = inboundTaskPool.popTask(n).concat(outboundTaskPool.popTask(n));
    if (tasks.length <= 0) return;

    const confirmTx = (txHash: string): Promise<void> => {
        return new Promise((resolve) => {
            provider.onTxConfirmed(txHash, () => {
                resolve();
            }, 1);
        });
    }


    tasks.forEach(async task => {
        console.log(`Begin to excute ${task.taskType} task:[${task.id}] receiver:${task.functionCallData.functionArgs.receiver} amount:${task.functionCallData.functionArgs.amount}]`);
        let txHash;
        switch (task.taskType) {
            case TaskType.INBOUND: {
                txHash = await sendTxDoInboundTask(walletInbound, task);
                break;
            }
            case TaskType.OUTBOUND: {
                txHash = await sendTxDoOutboundTask(walletOutbound, task);
                break;
            }

            default:
                break;
        }

        if (txHash) {
            await confirmTx(txHash);
            task.finishedTx = txHash;
            task.status = TaskStatus.SUCCESS;
        }
    })

}

function betch32AddressToMeshData(addr: string) {
    const a = deserializeAddress(addr);

    if (a.pubKeyHash) {
        if (a.stakeCredentialHash) return mPubKeyAddress(a.pubKeyHash, a.stakeCredentialHash, false);
        else return mPubKeyAddress(a.pubKeyHash, a.stakeScriptCredentialHash, true);
    } else {
        if (a.stakeCredentialHash) return mPubKeyAddress(a.scriptHash, a.stakeCredentialHash, false);
        else return mScriptAddress(a.scriptHash, a.stakeScriptCredentialHash, true)
    }
}

function genBeneficiaryData(receiver: string, amount: string | bigint | number) {
    const isValidCardanoAddress = (addr: string) => {
        try {
            const a = deserializeAddress(addr);
            return true;
        } catch (error) {
            return false;
        }
    }

    const to = isValidCardanoAddress(receiver) ? mConStr1([betch32AddressToMeshData(receiver)]) : mConStr0([Buffer.from(receiver, 'ascii').toString('hex')]);
    return mConStr0([to, amount]);
}
function genMsgCrossData(to: string, amount: string | bigint | number, direction: TaskType) {
    const script = contractsInfo.inboundDemoScript;
    const scriptHash = resolveScriptHash(script.code, script.version);
    const taskId = direction == TaskType.INBOUND ? Buffer.alloc(32, Math.random().toString(16)).toString('hex') : '';
    const fromChainId = direction == TaskType.INBOUND ? defaultConfig.EvmChainId : defaultConfig.AdaChainId;
    const fromAddress = direction == TaskType.OUTBOUND ? mConStr1([mScriptAddress(scriptHash)]) : mConStr0([defaultConfig.EvmContractADDRESS]);
    const toChainId = direction == TaskType.INBOUND ? defaultConfig.AdaChainId : defaultConfig.EvmChainId;

    const toAddress = direction == TaskType.INBOUND ? mConStr1([mScriptAddress(scriptHash)]) : mConStr0([defaultConfig.EvmContractADDRESS]);
    const gasLimit = 2000000;
    // const receiver = direction == TaskType.INBOUND ? mConStr1([betch32AddressToMeshData(to)]): mConStr0([Buffer.from(to,'ascii').toString('hex')]);
    const tmpCallData = mConStr0(['wmbReceive', genBeneficiaryData(to, amount)]);
    return mConStr0([taskId, fromChainId, fromAddress, toChainId, toAddress, gasLimit, tmpCallData]);
    // return mConStr0([receiver, amount]);
}

function getBeneficiaryFromCbor(hex: string) {
    const datum = deserializeDatum(hex);
    const subDatum = datum.fields[0];
    const receiver = subDatum.constructor == 0n ? subDatum.fields[0].bytes : serializeAddressObj(subDatum.fields[0].fields[0], defaultConfig.NETWORK);
    const amount = datum.fields[1].int;

    return { receiver, amount };
}

function getMsgCrossDataFromCbor(hex: string) {
    const datum = deserializeDatum(hex);
    const msgId = datum.fields[0].bytes;
    const fromChainId = datum.fields[1].int;
    const fromContract = datum.fields[2].constructor == 0n ? datum.fields[2].fields[0].bytes : serializeAddressObj(datum.fields[2].fields[0], defaultConfig.NETWORK);
    const toChainId = datum.fields[3].int;

    const targetContract = datum.fields[4].constructor == 0n ? datum.fields[4].fields[0].bytes : serializeAddressObj(datum.fields[4].fields[0], defaultConfig.NETWORK);
    const gasLimit = datum.fields[5].int;
    // console.log('=====-->',datum.fields.length,datum.fields[6].fields[1]);
    const tmpCallData = datum.fields[6].fields[1].bytes;

    const functionCallData = {
        functionName: datum.fields[6].fields[0].bytes,
        functionArgs: getBeneficiaryFromCbor(tmpCallData)
    }
    return { msgId, fromChainId, fromContract, toChainId, targetContract, gasLimit, functionCallData };
}


async function createInboundTask(to: string, amount: string | bigint | number) {
    const utxos = await walletInbound.getUtxos();
    const txBuilder = new MeshTxBuilder({ fetcher: provider, submitter: provider, });

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
    // console.log(unsignedTx);
    const signedTx = await walletInbound.signTx(unsignedTx);
    // console.log(signedTx);
    const txHash = await walletInbound.submitTx(signedTx);
    console.log(`create Inbound Task tx: ${txHash}`);
}


async function createOutboundTask(wallet: MeshWallet, to: string, amount: string | bigint | number) {
    // const utxos = await walletUser.getUtxos();
    // const txBuilder = new MeshTxBuilder({ fetcher: provider, submitter: provider, });

    let assets = [{ unit: contractsInfo.demoTokenPolicy + defaultConfig.demoTokenName, quantity: BigInt(amount).toString(10) }];
    // const { scriptAddress } = getOutboundDemoScript();contractsInfo.outboundDemoAddress
    const datum = genBeneficiaryData(to, amount);
    // let outputOfTarget: Output = {
    //     address: contractsInfo.outboundDemoAddress,
    //     amount: assets,
    //     datum: {
    //         type: 'Inline',
    //         data: {
    //             type: "Mesh",
    //             content: datum
    //         }
    //     }
    // }


    // const minAda = txBuilder.calculateMinLovelaceForOutput(outputOfTarget);
    // assets.push({ unit: 'lovelace', quantity: minAda.toString(10) });

    const tx = new Transaction({ fetcher: provider, submitter: provider, initiator: wallet })
        .sendAssets({
            address: contractsInfo.outboundDemoAddress,
            datum: { value: datum, inline: true },
        }, assets);
    const unsignedTx = await tx.build();
    // console.log(unsignedTx);
    const signedTx = await wallet.signTx(unsignedTx);
    // console.log(signedTx);
    const txHash = await wallet.submitTx(signedTx);
    console.log(`create outbound Task tx: ${txHash}`);
    return txHash;
}

async function sendTxDoOutboundTask(wallet: MeshWallet, task: Task) {

    let outboundTaskUtxo = task.utxo;
    const beneficiary = getBeneficiaryFromCbor(outboundTaskUtxo.output.plutusData);

    const asset = outboundTaskUtxo.output.amount.find((item) => (item.unit.indexOf(contractsInfo.demoTokenPolicy) == 0));
    if (!asset || BigInt(asset.quantity) < BigInt(beneficiary.amount)) { throw 'not enough token' };

    const txBuilder = new MeshTxBuilder({ fetcher: provider, submitter: provider, evaluator: provider });
    let assetsOfOutboundToken = [{
        unit: contractsInfo.outboundTokenPolicy + defaultConfig.OUTBOUND_TOKEN_NAME,
        quantity: '1'
    }];

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
    //   burn_policy: PolicyId,
    //   burn_token_name: AssetName,
    //   xport: Address,
    const outboundRedeemer = mConStr0([contractsInfo.demoTokenPolicy, defaultConfig.demoTokenName, betch32AddressToMeshData(contractsInfo.xportAddress)]);
    
    const changeAddress = await wallet.getChangeAddress();
    await txBuilder
        .spendingPlutusScript(contractsInfo.outboundDemoScript.version)
        .txIn(outboundTaskUtxo.input.txHash, outboundTaskUtxo.input.outputIndex, outboundTaskUtxo.output.amount, outboundTaskUtxo.output.address, 0)
        .spendingReferenceTxInInlineDatumPresent()
        .spendingReferenceTxInRedeemerValue(outboundRedeemer).txInScript(contractsInfo.outboundDemoScript.code)
        .mintPlutusScript(contractsInfo.demoTokenScript.version)
        .mint('-' + BigInt(beneficiary.amount).toString(10), contractsInfo.demoTokenPolicy, defaultConfig.demoTokenName)
        .mintingScript(contractsInfo.demoTokenScript.code)
        .mintRedeemerValue("")
        .txOut(contractsInfo.xportAddress, assetsOfOutboundToken)
        .txOutInlineDatumValue(outboundDatum)
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
    // const exUnit = await provider.evaluateTx(signedTx);
    console.log('outboundTransfer tx:', signedTx);
    const txHash = await wallet.submitTx(signedTx);
    return txHash;
}



async function timeout(ms: number, promise: Promise<any>) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), ms)
        ),
    ]);

}

async function sleep(milsec: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve();
        }, milsec);
    })
}

async function monitor() {
    while (1) {
        await fetchTask(provider, TaskType.INBOUND);
        await fetchTask(provider, TaskType.OUTBOUND);
        await doTask(3);
        inboundTaskPool.removeDone();
        await sleep(5000);
    }
}


async function walletReady(wallet: MeshWallet) {
    let colleteralUtxo = await wallet.getCollateral();
    if (colleteralUtxo.length === 0) {
        console.log(`wallet ${wallet.getAddresses().baseAddressBech32} has no collateral utxo, create collateral utxo auto ...`);
        await wallet.createCollateral();
        const waitFetchCollateral = async () => {
            while (colleteralUtxo.length === 0) {
                colleteralUtxo = await wallet.getCollateral();
                sleep(5000);
            }

        }
        await timeout(30000, waitFetchCollateral());
        console.log('create collateral utxo success:', colleteralUtxo[0]);
    }
    const balance = await wallet.getBalance();

    console.log('balance:');
    balance.forEach((item) => {
        console.log('\t', item.unit, item.quantity);
    });
    console.log('collateral utxo:');
    colleteralUtxo.forEach(utxo => {
        console.log('\t', utxo.input.txHash, utxo.input.outputIndex, JSON.stringify(utxo.output.amount), utxo.output.address);
    })
}
async function loadWallet(seed: string) {

    let wallet = new MeshWallet({
        networkId: defaultConfig.NETWORK ? 1 : 0, // 0: testnet, 1: mainnet
        fetcher: provider,
        submitter: provider,
        key: {
            type: 'cli',
            payment: seed,//'5820' + process.env.ACCOUNT_SEED1,
            stake: seed,//'5820' + process.env.ACCOUNT_SEED1,
        },
    });

    await wallet.init();
    console.log('wallet address:', wallet.addresses.baseAddressBech32);
    return wallet;
}


async function main() {
    // const aa = await ogmios.fetchProtocolParameters();
    walletInbound = await loadWallet('5820' + process.env.ACCOUNT_SEED1);
    walletOutbound = await loadWallet('5820' + process.env.ACCOUNT_SEED2);
    // walletUser = await loadWallet('5820' + process.env.ACCOUNT_SEED3);

    await walletReady(walletInbound);
    await walletReady(walletOutbound);
    // await walletReady(walletUser);
    await monitor();
}

// main().catch((err) => {
//     console.log('error:', err);
// });

export const userCossChainTransfer = async () => {
    walletUser = await loadWallet('5820' + process.env.ACCOUNT_SEED3);
    return await createOutboundTask(walletUser, receiverOnEvm, CROSS_TRANSFER_AMOUNT);
}


import { Command } from 'commander';
const program = new Command();

program.name('msg-agent').description('demo agent for msg cross chian').version('1.0.0');

program
    .command('monitor')
    .description('Start monitoring inbound outbound tasks and processing them')
    .action(async () => {
        walletInbound = await loadWallet('5820' + process.env.ACCOUNT_SEED1);
        walletOutbound = await loadWallet('5820' + process.env.ACCOUNT_SEED2);
        walletUser = await loadWallet('5820' + process.env.ACCOUNT_SEED3);

        await walletReady(walletInbound);
        await walletReady(walletOutbound);
        // await walletReady(walletUser);
        await monitor();
    });

program
    .command('client')
    .description('cross-transfer demoToken')
    .action(async () => {
        walletUser = await loadWallet('5820' + process.env.ACCOUNT_SEED3);
        await createOutboundTask(walletUser, receiverOnEvm, CROSS_TRANSFER_AMOUNT);
    });

program.parse(process.argv);