import { spawn, ChildProcess } from 'child_process'
import Debug from 'debug'
import { BigNumber, BigNumberish } from 'ethers'
import { JsonRpcProvider } from '@ethersproject/providers'
import { isBigNumber } from 'hardhat/common'
import { decodeRevertReason } from './testutils'

const debug = Debug('aa.geth')

// launcher scripts for executables.
// should use "trap" to kill launched process on exit.
// executed with single parameter: port to listen
const launchers = {
  geth: './scripts/geth.sh',
  anvil: './scripts/anvil.sh'
}

export type LauncherName = keyof typeof launchers

interface Eip7702Transaction {
  to: string
  data?: string
  value?: BigNumberish
  gas?: BigNumberish
  authorizationList?: any
}

export class GethExecutable {
  gethFrom: string
  provider: JsonRpcProvider
  port = Math.floor(5000 + Math.random() * 10000)

  impl: string
  constructor (private readonly implName: LauncherName = 'geth') {
    this.impl = launchers[implName]
  }

  private gethProcess: ChildProcess | null = null

  markerString = /HTTP server started|Listening on/

  rpcUrl (): string {
    return `http://localhost:${this.port}`
  }

  async init (): Promise<void> {
    await this.initProcess()
    this.provider = new JsonRpcProvider(this.rpcUrl())
    this.gethFrom = (await this.provider.send('eth_accounts', []))[0]
  }

  async sendTx (tx: Eip7702Transaction): Promise<string> {
    // todo: geth is strict on values (e.g. leading hex zero digits not allowed)
    // might need to add more cleanups here..
    const tx1 = {
      from: this.gethFrom,
      ...tx
    } as any
    for (const key of Object.keys(tx1)) {
      if (typeof tx1[key] === 'number' || isBigNumber(tx1[key])) {
        tx1[key] = BigNumber.from(tx1[key]).toHexString()
      }
      // ugly: numbers must not have leading zeros, but addresses must have 40 chars
      if (typeof tx1[key] === 'string' && tx1[key].length < 42) {
        tx1[key] = tx1[key].replace(/0x0\B/, '0x')
      }
    }
    // console.log('tx=', await geth.provider.getTransactionReceipt(hash))

    const hash = await this.provider.send('eth_sendTransaction', [tx1]).catch(e => {
      throw new Error(decodeRevertReason(e.error.data) ?? e.error.message)
    })
    while (await this.provider.getTransactionReceipt(hash) == null) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    return hash
  }

  // equivalent to provider.call, but supports 7702 authorization
  async call (tx: Eip7702Transaction): Promise<any> {
    return await this.provider.send('eth_call', [{
      from: this.gethFrom,
      ...tx
    }])
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion

  async initProcess (): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log('spawning: ', this.impl, this.port)
      this.gethProcess = spawn(this.impl, [this.port.toString()])

      let allData = ''
      if (this.gethProcess != null) {
        const timeout = setTimeout(() => {
          reject(new Error(`Timed out waiting for marker regex: ${this.markerString.toString()}\n: ${allData}`))
        }, 5000)

        this.gethProcess.stdout?.on('data', (data: string) => {
          data = data.toString()
          allData += data
          debug('stdout:', data)
          if (data.match(this.markerString) != null) {
            clearTimeout(timeout)
            resolve()
          }
        })
        this.gethProcess.stderr?.on('data', (data: string) => {
          data = data.toString()
          allData += data
          debug('stderr:', data)

          if (data.match(this.markerString) != null) {
            clearTimeout(timeout)
            resolve()
          }
        })

        this.gethProcess.on('exit', (code: number | null) => {
          console.log(`${this.impl}: process exited with code ${code}`)
        })
      } else {
        reject(new Error('Failed to start geth process'))
      }
    })
  }

  done (): void {
    if (this.gethProcess != null) {
      debug('killing geth')
      this.gethProcess.kill()
    }
  }
}
