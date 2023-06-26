import { clearInterval } from 'timers'
import { getAccountAddress, getAccountInitCode } from '../test/testutils'
import { fillAndSign, getUserOpHash } from '../test/UserOp'
import { UserOperation } from '../test/UserOperation'
import {
  EntryPoint,
  EntryPoint__factory,
  SimpleAccount,
  SimpleAccountFactory,
  SimpleAccountFactory__factory,
  SimpleAccount__factory
} from '../src/types'

import {
  AbstractProvider,
  AbstractSigner,
  BigNumberish, BytesLike, ContractTransactionReceipt, EventLog, getBigInt,
  hexlify, JsonRpcProvider,
  Provider,
  resolveAddress, Signature,
  Signer, toBigInt, TransactionReceipt, TransactionRequest,
  TransactionResponse, TypedDataDomain, TypedDataField
} from 'ethers'

export type SendUserOp = (userOp: UserOperation) => Promise<TransactionResponse | undefined>

export const debug = process.env.DEBUG != null

/**
 * send a request using rpc.
 *
 * @param provider - rpc provider that supports "eth_sendUserOperation"
 */
export function rpcUserOpSender (provider: JsonRpcProvider, entryPointAddress: string): SendUserOp {
  let chainId: BigNumberish

  return async function (userOp) {
    if (debug) {
      console.log('sending eth_sendUserOperation', {
        ...userOp,
        initCode: (userOp.initCode ?? '').length,
        callData: (userOp.callData ?? '').length
      }, entryPointAddress)
    }
    if (chainId === undefined) {
      chainId = await provider.getNetwork().then(net => net.chainId)
    }

    const cleanUserOp = Object.keys(userOp).map(key => {
      let val = (userOp as any)[key]
      if (typeof val !== 'string' || !val.startsWith('0x')) {
        val = hexlify(val)
      }
      return [key, val]
    })
      .reduce((set, [k, v]) => ({ ...set, [k]: v }), {})
    await provider.send('eth_sendUserOperation', [cleanUserOp, entryPointAddress]).catch(e => {
      throw e.error ?? e
    })
    return undefined
  }
}

interface QueueSendUserOp extends SendUserOp {
  lastQueueUpdate: number
  queueSize: number
  queue: { [sender: string]: UserOperation[] }
  push: () => Promise<void>
  setInterval: (intervalMs: number) => void
  cancelInterval: () => void

  _cancelInterval: any
}

/**
 * a SendUserOp that queue requests. need to call sendQueuedUserOps to create a bundle and send them.
 * the returned object handles the queue of userops and also interval control.
 */
export function queueUserOpSender (entryPointAddress: string, signer: Signer, intervalMs = 3000): QueueSendUserOp {
  const entryPoint = EntryPoint__factory.connect(entryPointAddress, signer)

  const ret = async function (userOp: UserOperation) {
    const senderAddress = await resolveAddress(userOp.sender)
    if (ret.queue[senderAddress] == null) {
      ret.queue[senderAddress] = []
    }
    ret.queue[senderAddress].push(userOp)
    ret.lastQueueUpdate = Date.now()
    ret.queueSize++
  } as QueueSendUserOp

  ret.queue = {}
  ret.push = async function () {
    await sendQueuedUserOps(ret, entryPoint)
  }
  ret.setInterval = function (intervalMs: number) {
    ret.cancelInterval()
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    ret._cancelInterval = setInterval(ret.push, intervalMs)
  }
  ret.cancelInterval = function () {
    if (ret._cancelInterval != null) {
      clearInterval(ret._cancelInterval)
      ret._cancelInterval = null
    }
  }

  if (intervalMs != null) {
    ret.setInterval(intervalMs)
  }

  return ret
}

/**
 * create a bundle from the queue and send it to the entrypoint.
 * NOTE: only a single request from a given sender can be put into a bundle.
 * @param queue
 * @param entryPoint
 */

let sending = false

// after that much time with no new TX, send whatever you can.
const IDLE_TIME = 5000

// when reaching this theshold, don't wait anymore and send a bundle
const BUNDLE_SIZE_IMMEDIATE = 3

async function sendQueuedUserOps (queueSender: QueueSendUserOp, entryPoint: EntryPoint): Promise<void> {
  if (sending) {
    console.log('sending in progress. waiting')
    return
  }
  sending = true
  try {
    if (queueSender.queueSize < BUNDLE_SIZE_IMMEDIATE || queueSender.lastQueueUpdate + IDLE_TIME > Date.now()) {
      console.log('queue too small/too young. waiting')
      return
    }
    const ops: UserOperation[] = []
    const queue = queueSender.queue
    Object.keys(queue).forEach(sender => {
      const op = queue[sender].shift()
      if (op != null) {
        ops.push(op)
        queueSender.queueSize--
      }
    })
    if (ops.length === 0) {
      console.log('no ops to send')
      return
    }
    const signer = await (entryPoint.runner as any).getSigner().getAddress()
    console.log('==== sending batch of ', ops.length)
    const ret = await entryPoint.handleOps(ops, signer, { maxPriorityFeePerGas: 2e9 })
    console.log('handleop tx=', ret.hash)
    const rcpt = await ret.wait() as ContractTransactionReceipt
    console.log('events=', (rcpt.logs as EventLog[]).map(e => ({ name: e.eventName, args: e.args })))
  } finally {
    sending = false
  }
}

/**
 * send UserOp using handleOps, but locally.
 * for testing: instead of connecting through RPC to a remote host, directly send the transaction
 * @param entryPointAddress the entryPoint address to use.
 * @param signer ethers provider to send the request (must have eth balance to send)
 * @param beneficiary the account to receive the payment (from account/paymaster). defaults to the signer's address
 */
export function localUserOpSender (entryPointAddress: string, signer: Signer, beneficiary?: string): SendUserOp {
  const entryPoint = EntryPoint__factory.connect(entryPointAddress, signer)
  return async function (userOp) {
    if (debug) {
      console.log('sending', {
        ...userOp,
        initCode: userOp.initCode.length <= 2 ? userOp.initCode : `<len=${userOp.initCode.length}>`
      })
    }
    const gasLimit = getBigInt(userOp.preVerificationGas) + getBigInt(userOp.verificationGasLimit) + getBigInt(userOp.callGasLimit)
    console.log('calc gaslimit=', gasLimit.toString())
    const ret = await entryPoint.handleOps([userOp], beneficiary ?? await signer.getAddress(), {
      maxPriorityFeePerGas: userOp.maxPriorityFeePerGas,
      maxFeePerGas: userOp.maxFeePerGas
    })
    await ret.wait()
    return undefined
  }
}

export class AAProvider extends AbstractProvider {
  private readonly entryPoint: EntryPoint

  constructor (entryPointAddress: string, provider: Provider) {
    super('any')
    this.entryPoint = EntryPoint__factory.connect(entryPointAddress, provider)
  }
}

/**
 * a signer that wraps account-abstraction.
 */
export class AASigner extends AbstractSigner {
  _account?: SimpleAccount

  private _isPhantom = true
  public entryPoint: EntryPoint
  public accountFactory: SimpleAccountFactory

  private _chainId: Promise<bigint> | undefined

  /**
   * create account abstraction signer
   * @param signer - the underlying signer. has no funds (=can't send TXs)
   * @param entryPoint the entryPoint contract. used for read-only operations
   * @param sendUserOp function to actually send the UserOp to the entryPoint.
   * @param index - index of this account for this signer.
   */
  constructor (readonly signer: Signer, readonly entryPointAddress: string, readonly sendUserOp: SendUserOp, readonly accountFactoryAddress: string, readonly index = 0, readonly provider = signer.provider) {
    super()
    this.entryPoint = EntryPoint__factory.connect(entryPointAddress, signer)
    this.accountFactory = SimpleAccountFactory__factory.connect(accountFactoryAddress, signer)
  }

  // connect to a specific pre-deployed address
  // (note: in order to send transactions, the underlying signer address must be valid signer for this account (its owner)
  async connectAccountAddress (address: string): Promise<void> {
    if (this._account != null) {
      throw Error('already connected to account')
    }
    if (await this.provider!.getCode(address).then(code => code.length) <= 2) {
      throw new Error('cannot connect to non-existing contract')
    }
    this._account = SimpleAccount__factory.connect(address, this.signer)
    this._isPhantom = false
  }

  connect (provider: Provider): Signer {
    throw new Error('connect not implemented')
  }

  async getAddress (): Promise<string> {
    await this.syncAccount()
    return this._account!.getAddress()
  }

  async signMessage (message: BytesLike | string): Promise<string> {
    throw new Error('signMessage: unsupported by AA')
  }

  async signTypedData (domain: TypedDataDomain, types: Record<string, TypedDataField[]>, value: Record<string, any>): Promise<string> {
    throw new Error('signTypedMessage: unsupported by AA')
  }

  async signTransaction (transaction: TransactionRequest): Promise<string> {
    throw new Error('signMessage: unsupported by AA')
  }

  async getAccount (): Promise<SimpleAccount> {
    await this.syncAccount()
    return this._account!
  }

  // fabricate a response in a format usable by ethers users...
  async userEventResponse (userOp: UserOperation): Promise<TransactionResponse> {
    const entryPoint = this.entryPoint
    const userOpHash = getUserOpHash(userOp, entryPoint.target, await this._chainId!)
    const provider = entryPoint.runner?.provider as Provider
    const currentBLock = provider.getBlockNumber()

    let resolved = false
    const waitPromise = new Promise<TransactionReceipt>((resolve, reject) => {
      let listener = async function (this: any, ...param: any): Promise<void> {
        if (resolved) return
        const event = arguments[arguments.length - 1] as EventLog
        if (event.blockNumber <= await currentBLock) {
          // not sure why this callback is called first for previously-mined block..
          console.log('ignore previous block', event.blockNumber)
          return
        }
        if (event.args == null) {
          console.error('got event without args', event)
          return
        }
        if (event.args.userOpHash !== userOpHash) {
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions,@typescript-eslint/no-base-to-string
          console.log(`== event with wrong userOpHash: sender/nonce: event.${event.args.sender}@${event.args.nonce.toString()}!= userOp.${userOp.sender}@${parseInt(userOp.nonce.toString())}`)
          return
        }

        let rcpt = await event.getTransactionReceipt()
        console.log('got event with status=', event.args.success, 'gasUsed=', rcpt.gasUsed)

        // TODO: should use "userOpHash" as "transactionId" (but this has to be done in a provider, not a signer)

        // before returning the receipt, update the status from the event.
        // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
        if (!event.args.success) {
          console.log('mark tx as failed')
          rcpt = new TransactionReceipt({
            ...rcpt,
            logs: rcpt.logs,
            status: 0
          }, provider)
          const revertReasonEvents = await entryPoint.queryFilter(entryPoint.filters.UserOperationRevertReason(userOpHash), rcpt.blockHash)
          // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
          if (revertReasonEvents[0]) {
            console.log('rejecting with reason')
            reject(new Error(`UserOp failed with reason: ${revertReasonEvents[0].args.revertReason}`)
            )
            return
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        void entryPoint.off('UserOperationEvent', listener)
        resolve(rcpt)
        resolved = true
      }
      listener = listener.bind(listener)
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      void entryPoint.on('UserOperationEvent' as any, listener)
      // for some reason, 'on' takes at least 2 seconds to be triggered on local network. so add a one-shot timer:
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      setTimeout(async () => await entryPoint.queryFilter(entryPoint.filters.UserOperationEvent(userOpHash)).then(query => {
        if (query.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          listener(query[0])
        }
      }), 500)
    })
    const resp = new TransactionResponse({

      blockNumber: null,
      blockHash: null,
      index: 0,
      type: 2,
      to: null,
      gasPrice: 0n,
      maxPriorityFeePerGas: null,
      maxFeePerGas: null,
      signature: Signature.from(undefined),
      accessList: null,

      hash: userOpHash,
      from: await resolveAddress(userOp.sender),
      nonce: getBigInt(userOp.nonce) as any,
      gasLimit: getBigInt(userOp.callGasLimit), // ??
      value: getBigInt(0),
      data: hexlify(userOp.callData), // should extract the actual called method from this "execFromSingleton()" call
      chainId: toBigInt(await this._chainId!)
    }, provider)
    resp.wait = async function (confirmations?: number): Promise<TransactionReceipt> {
      return await waitPromise
    }
    return resp
  }

  async sendTransaction (transaction: TransactionRequest): Promise<TransactionResponse> {
    const userOp = await this._createUserOperation(transaction)
    // get response BEFORE sending request: the response waits for events, which might be triggered before the actual send returns.
    const reponse = await this.userEventResponse(userOp)
    await this.sendUserOp(userOp)
    return reponse
  }

  async syncAccount (): Promise<void> {
    if (this._account == null) {
      const address = await getAccountAddress(await this.signer.getAddress(), this.accountFactory)
      this._account = SimpleAccount__factory.connect(address, this.signer)
    }

    this._chainId = this.provider?.getNetwork().then(net => net.chainId)
    // once an account is deployed, it can no longer be a phantom.
    // but until then, we need to re-check
    if (this._isPhantom) {
      const size = await this.signer.provider?.getCode(this._account.target).then(x => x.length)
      // console.log(`== __isPhantom. addr=${this._account.address} re-checking code size. result = `, size)
      this._isPhantom = size === 2
      // !await this.entryPoint.isContractDeployed(await this.getAddress());
    }
  }

  // return true if account not yet created.
  async isPhantom (): Promise<boolean> {
    await this.syncAccount()
    return this._isPhantom
  }

  async _createUserOperation (tx: TransactionRequest): Promise<UserOperation> {
    await this.syncAccount()

    let initCode: BytesLike | undefined
    if (this._isPhantom) {
      initCode = await getAccountInitCode(await this.signer.getAddress(), this.accountFactory)
    }
    const execFromEntryPoint = await this._account!.execute.populateTransaction(tx.to!, tx.value ?? 0, tx.data!)

    let { gasPrice, maxPriorityFeePerGas, maxFeePerGas } = tx
    // gasPrice is legacy, and overrides eip1559 values:
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (gasPrice) {
      maxPriorityFeePerGas = gasPrice
      maxFeePerGas = gasPrice
    }
    const userOp = await fillAndSign({
      sender: await this._account?.getAddress(),
      initCode,
      nonce: initCode == null ? tx.nonce! : this.index,
      callData: execFromEntryPoint.data!,
      callGasLimit: tx.gasLimit!,
      maxPriorityFeePerGas: maxPriorityFeePerGas!,
      maxFeePerGas: maxFeePerGas!
    }, this.signer, this.entryPoint)

    return userOp
  }
}
