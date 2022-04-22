import hre, {ethers} from "hardhat";
import {BytesLike} from "@ethersproject/bytes";
import {expect} from "chai";
import {decodeRevertReason, rethrow} from "../src/userop/utils";
import {debugTransaction} from "./debugTx";
import {arrayify, keccak256, parseEther} from "ethers/lib/utils";
import {BigNumber, BigNumberish, Contract, ContractReceipt, Event, Wallet} from "ethers";
import {
  EntryPoint,
  EntryPoint__factory,
  IERC20,
  SimpleWallet__factory
} from '../typechain-types'
import {Create2Factory} from "../src/Create2Factory";

export const HashZero = ethers.constants.HashZero
export const ONE_ETH = parseEther('1');
export const TWO_ETH = parseEther('2');
export const FIVE_ETH = parseEther('5');

export const tostr = (x: any) => x != null ? x.toString() : 'null'

export function tonumber(x: any): number {

  try {
    return parseFloat(x.toString())
  } catch (e) {
    console.log('=== failed to parseFloat:', x, (e as any).message)
    return NaN
  }
}

//just throw 1eth from account[0] to the given address (or contract instance)
export async function fund(contractOrAddress: string | Contract, amountEth = '1') {
  let address: string
  if (typeof contractOrAddress == 'string') {
    address = contractOrAddress
  } else {
    address = contractOrAddress.address
  }
  await ethers.provider.getSigner().sendTransaction({to: address, value: parseEther(amountEth)})
}

export async function getBalance(address: string): Promise<number> {
  const balance = await ethers.provider.getBalance(address)
  return parseInt(balance.toString())
}

export async function getTokenBalance(token: IERC20, address: string): Promise<number> {
  const balance = await token.balanceOf(address)
  return parseInt(balance.toString())
}


let counter = 0

//create non-random account, so gas calculations are deterministic
export function createWalletOwner(): Wallet {
  const privateKey = keccak256(Buffer.from(arrayify(BigNumber.from(++counter))))
  return new ethers.Wallet(privateKey, ethers.provider)
  // return new ethers.Wallet('0x'.padEnd(66, privkeyBase), ethers.provider);
}

export function createAddress(): string {
  return createWalletOwner().address
}

export function callDataCost(data: string): number {
  return ethers.utils.arrayify(data)
    .map(x => x == 0 ? 4 : 16)
    .reduce((sum, x) => sum + x)
}

export async function calcGasUsage(rcpt: ContractReceipt, entryPoint: EntryPoint, beneficiaryAddress?: string): Promise<{ actualGasCost: BigNumberish }> {
  const actualGas = await rcpt.gasUsed
  const logs = await entryPoint.queryFilter(entryPoint.filters.UserOperationEvent(), rcpt.blockHash)
  const {actualGasCost, actualGasPrice} = logs[0].args
  console.log('\t== actual gasUsed (from tx receipt)=', actualGas.toString())
  let calculatedGasUsed = actualGasCost.toNumber() / actualGasPrice.toNumber();
  console.log('\t== calculated gasUsed (paid to beneficiary)=', calculatedGasUsed)
  const tx = await ethers.provider.getTransaction(rcpt.transactionHash)
  console.log('\t== gasDiff', actualGas.toNumber() - calculatedGasUsed - callDataCost(tx.data))
  if (beneficiaryAddress != null) {
    expect(await getBalance(beneficiaryAddress)).to.eq(actualGasCost.toNumber())
  }
  return {actualGasCost}
}

//helper function to create a constructor call to our wallet.
export function WalletConstructor(entryPoint: string, owner: string): BytesLike {
  return new SimpleWallet__factory().getDeployTransaction(entryPoint, owner).data!
}

let currentNode: string = ''

//basic geth support
// - by default, has a single account. our code needs more.
export async function checkForGeth() {
  // @ts-ignore
  const provider = ethers.provider._hardhatProvider

  currentNode = await provider.request({method: 'web3_clientVersion'})

  //NOTE: must run geth with params:
  // --http.api personal,eth,net,web3
  // --allow-insecure-unlock
  if (currentNode.match(/geth/i)) {
    for (let i = 0; i < 2; i++) {
      const acc = await provider.request({method: 'personal_newAccount', params: ['pass']}).catch(rethrow)
      await provider.request({method: 'personal_unlockAccount', params: [acc, 'pass']}).catch(rethrow)
      await fund(acc)
    }
  }
}

//remove "array" members, convert values to strings.
// so Result obj like
// { '0': "a", '1': 20, first: "a", second: 20 }
// becomes:
// { first: "a", second: "20" }
export function objdump(obj: { [key: string]: any }) {
  return Object.keys(obj)
    .filter(key => !key.match(/^[\d_]/))
    .reduce((set, key) => ({
      ...set,
      [key]: decodeRevertReason(obj[key].toString(), false)
    }), {})
}

export function eventDump(obj: Event | Event[]): any {
  if (Array.isArray(obj)) {
    return obj.map(item => eventDump(item))
  }
  const args = obj.args
  return {
    ev: obj.event,
    ...objdump(args as any)
  }
}

export async function checkForBannedOps(txHash: string, checkPaymaster: boolean) {
  const debugTx = async (hash: string) => ethers.provider.send('debug_traceTransaction', [hash, {
    disableMemory: true,
    disableStorage: true
  }])

  const tx = await debugTransaction(txHash)
  const logs = tx.structLogs
  const blockHash = logs.map((op, index) => ({op: op.op, index})).filter(op => op.op == 'NUMBER')
  expect(blockHash.length).to.equal(1, "expected exactly 1 call to NUMBER (Just before validatePaymasterUserOp)")
  const validateWalletOps = logs.slice(0, blockHash[0].index - 1)
  const validatePaymasterOps = logs.slice(blockHash[0].index + 1)
  const ops = validateWalletOps.filter(log => log.depth > 1).map(log => log.op)
  const paymasterOps = validatePaymasterOps.filter(log => log.depth > 1).map(log => log.op)

  expect(ops).to.include('POP', 'not a valid ops list: ' + ops) //sanity
  const bannedOpCodes = new Set(['GAS', 'BASEFEE', 'GASPRICE', 'NUMBER'])
  expect(ops.filter((op, index) => {
    //don't ban "GAS" op followed by "*CALL"
    if (op == 'GAS' && ops[index + 1].match(/CALL/)) {
      return false
    }
    return bannedOpCodes.has(op)
  })).to.eql([])
  if (checkPaymaster) {
    expect(paymasterOps).to.include('POP', 'not a valid ops list: ' + paymasterOps) //sanity
    expect(paymasterOps).to.not.include('BASEFEE')
    expect(paymasterOps).to.not.include('GASPRICE')
  }
}

export async function deployEntryPoint(paymasterStake: BigNumberish, unstakeDelaySecs: BigNumberish): Promise<EntryPoint> {
  let provider = ethers.provider;
  await Create2Factory.init(provider)
  const factory = await new EntryPoint__factory(provider.getSigner())
  const entrypoint = await factory.deploy(Create2Factory.contractAddress, paymasterStake, unstakeDelaySecs)
  return entrypoint
}
