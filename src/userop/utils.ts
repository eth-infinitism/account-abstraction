import {utils, constants} from "ethers";
import {hexValue} from "@ethersproject/bytes";
import {tostr} from "../../test/testutils";

export const AddressZero = constants.AddressZero

export function callDataCost(data: string): number {
  return utils.arrayify(data)
    .map(x => x == 0 ? 4 : 16)
    .reduce((sum, x) => sum + x)
}

const panicCodes: { [key: string]: any } = {
  //from https://docs.soliditylang.org/en/v0.8.0/control-structures.html
  0x01: 'assert(false)',
  0x11: 'arithmetic overflow/underflow',
  0x12: 'divide by zero',
  0x21: 'invalid enum value',
  0x22: 'storage byte array that is incorrectly encoded',
  0x31: '.pop() on an empty array.',
  0x32: 'array sout-of-bounds or negative index',
  0x41: 'memory overflow',
  0x51: 'zero-initialized variable of internal function type'
}

export function decodeRevertReason(data: string, nullIfNoMatch = true): string | null {
  const methodSig = data.slice(0, 10)
  let dataParams = '0x' + data.slice(10);

  if (methodSig == '0x08c379a0') {
    const [err] = utils.defaultAbiCoder.decode(['string'], dataParams)
    return `Error(${err})`
  } else if (methodSig == '0x00fa072b') {
    const [opindex, paymaster, msg] = utils.defaultAbiCoder.decode(['uint256', 'address', 'string'], dataParams)
    return `FailedOp(${opindex}, ${paymaster != AddressZero ? paymaster : "none"}, ${msg})`
  } else if (methodSig == '0x4e487b71') {
    const [code] = utils.defaultAbiCoder.decode(['uint256'], dataParams)
    return 'Panic(' + panicCodes[code] || code + ')'
  }
  if (!nullIfNoMatch) {
    return data
  }
  return null

}

//rethrow "cleaned up" exception.
// - stack trace goes back to method (or catch) line, not inner provider
// - attempt to parse revert data (needed for geth)
// use with ".catch(rethrow())", so that current source file/line is meaningful.
export function rethrow(): (e: Error) => void {
  let callerStack = new Error().stack!.replace(/Error.*\n.*at.*\n/, '').replace(/.*at.* \(internal[\s\S]*/, '')

  if (arguments[0]) {
    throw new Error('must use .catch(rethrow()), and NOT .catch(rethrow)')
  }
  return function (e: Error) {
    let solstack = e.stack!.match(/((?:.* at .*\.sol.*\n)+)/)
    let stack = (solstack != null ? solstack[1] : '') + callerStack
    // const regex = new RegExp('error=.*"data":"(.*?)"').compile()
    const found = /error=.*?"data":"(.*?)"/.exec(e.message)
    let message: string
    if (found != null) {
      const data = found![1]
      message = decodeRevertReason(data) ?? e.message + ' - ' + data.slice(0, 100)
    } else {
      message = e.message
    }
    const err = new Error(message)
    err.stack = 'Error: ' + message + '\n' + stack
    throw err
  }
}

/**
 * map object values.
 * each object member's value is mapped using the mapFunc
 * @param obj object to
 * @param mapFunc a function to convert each value
 */
export function mapValues(obj: any, mapFunc: (obj: any) => any) {
  return Object.keys(obj)
    .reduce((set, k) => ({...set, [k]: mapFunc(obj[k])}), {})
}

/**
 * convert all object values to hexValue (works well with nubmers, BigNubmers, arrays, etc)
 * @param obj
 */
export function hexValues(obj:any): any {
  return mapValues(obj, hexValue)
}

/**
 * convert all object values to string using toString
 */
export function stringValues(obj:any) {
  return mapValues(obj,tostr)
}
