import {UserOperation} from "../userop/UserOperation";
import {SendUserOp} from "./AbstractAASigner";
import {Signer} from "ethers";
import {clearInterval} from "timers";
import {EntryPoint, EntryPoint__factory} from "../../typechain-types";

const debug = require('debug')('aa.userop.queue')

export interface QueueSendUserOp extends SendUserOp {
  lastQueueUpdate: number
  queueSize: number
  queue: { [sender: string]: UserOperation[] }
  push: () => Promise<void>
  setInterval: (intervalMs: number) => void
  cancelInterval: () => void

  _cancelInterval: any
}

let sending = false

//after that much time with no new TX, send whatever you can.
const IDLE_TIME = 5000
//when reaching this theshold, don't wait anymore and send a bundle
const BUNDLE_SIZE_IMMEDIATE = 3


/**
 * a SendUserOp that queue requests. need to call sendQueuedUserOps to create a bundle and send them.
 * the returned object handles the queue of userops and also interval control.
 */
export function queueUserOpSender(entryPointAddress: string, signer: Signer, intervalMs = 3000): QueueSendUserOp {
  const entryPoint = EntryPoint__factory.connect(entryPointAddress, signer)

  let ret = <QueueSendUserOp>async function (userOp: UserOperation) {
    if (ret.queue[userOp.sender] == null) {
      ret.queue[userOp.sender] = []
    }
    ret.queue[userOp.sender].push(userOp)
    ret.lastQueueUpdate = Date.now()
    ret.queueSize++
  }

  ret.queue = {}
  ret.push = async function () {
    await sendQueuedUserOps(ret, entryPoint)
  }
  ret.setInterval = function (intervalMs: number) {
    ret.cancelInterval()
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
 * @param queueSender
 * @param entryPoint
 */

export async function sendQueuedUserOps(queueSender: QueueSendUserOp, entryPoint: EntryPoint) {
  if (sending) {
    debug('sending in progress. waiting')
    return
  }
  sending = true;
  try {
    if (queueSender.queueSize < BUNDLE_SIZE_IMMEDIATE || queueSender.lastQueueUpdate + IDLE_TIME > Date.now()) {
      debug('queue too small/too young. waiting')
      return
    }
    let ops: UserOperation[] = []
    const queue = queueSender.queue
    Object.keys(queue).forEach(sender => {
      let op = queue[sender].shift();
      if (op != null) {
        ops.push(op)
        queueSender.queueSize--
      }
    })
    if (ops.length == 0) {
      debug('no ops to send')
      return
    }
    let signer = await (entryPoint.provider as any).getSigner().getAddress();
    debug('==== sending batch of ', ops.length)
    const ret = await entryPoint.handleOps(ops, signer, {maxPriorityFeePerGas: 2e9})
    debug('handleop tx=', ret.hash)
    const rcpt = await ret.wait()
    debug('events=', rcpt.events!.map(e => ({name: e.event, args: e.args})))
  } finally {
    sending = false
  }
}