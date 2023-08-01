import { TransactionRequest } from '@ethersproject/abstract-provider'
import { ethers } from 'hardhat'
import { expect } from 'chai'

import { EntryPoint, EntryPointSimulations__factory } from '../../typechain'
import { EntryPointSimulationsInterface } from '../../typechain/contracts/core/EntryPointSimulations'
import { deployEntryPoint } from '../testutils'

import EntryPointSimulations from '../../artifacts/contracts/core/EntryPointSimulations.sol/EntryPointSimulations.json'

// note: to check that the "code override" is properly supported by a node, see if this code returns '0xaa'
// { code: '0x60aa60005260206000f3' }
// 0000    60  PUSH1 0xaa
// 0002    60  PUSH1 0x00
// 0004    52  MSTORE
// 0005    60  PUSH1 0x20
// 0007    60  PUSH1 0x00
// 0009    F3  *RETURN

describe('EntryPointSimulations', function () {
  let entryPoint: EntryPoint
  let entryPointSimulations: EntryPointSimulationsInterface

  before(async function () {
    entryPoint = await deployEntryPoint()
    entryPointSimulations = EntryPointSimulations__factory.createInterface()
  })

  it('should use state diff when running the simulation', async function () {
    const data = entryPointSimulations.encodeFunctionData('return777')
    const tx: TransactionRequest = {
      to: entryPoint.address,
      data
    }
    const stateOverride = {
      [entryPoint.address]: {
        code: EntryPointSimulations.deployedBytecode
      }
    }
    const simulationResult = await ethers.provider.send('eth_call', [tx, 'latest', stateOverride])
    expect(parseInt(simulationResult, 16)).to.equal(777)
  })
})
