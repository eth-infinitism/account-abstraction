import {Contract} from "ethers";
//WIP

/**
 * wrap a contract so reverts will come from the calling site in the source
 * @param c
 */
function wrapContractThrows(c: Contract) {
  const save = c.callStatic.simulateValidation

// @ts-ignore
  const newfunc = async function () {
    try {
      // @ts-ignore
      await save.apply(this, arguments)
    } catch (e: any) {
      e.stack = new Error().stack
      throw e
    }
  }.bind(c.callStatic)
// @ts-ignore
  entryPointView = {callStatic: {simulateValidation: newfunc}}
}
