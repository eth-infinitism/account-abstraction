import { spawn, ChildProcess } from 'child_process'
import Debug from 'debug'

const debug = Debug('aa.geth')

const port = 54321
export const gethLauncher = {
  name: 'geth',
  exec: './scripts/geth.sh',
  args: `--http --http.api personal,eth,net,web3,debug --rpc.allow-unprotected-txs --allow-insecure-unlock --dev --http.port=${port}`
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const anvilLauncher = {
  name: 'anvil',
  exec: './scripts/anvil.sh',
  args: `--hardfork prague --port=${port}`
}

export class GethExecutable {
  constructor (private readonly impl = gethLauncher) {
  }

  private gethProcess: ChildProcess | null = null

  markerString = /HTTP server started|Listening on/

  rpcUrl (): string {
    return `http://localhost:${port}`
  }

  async init (): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log('spawning: ', this.impl.exec, this.impl.args)
      this.gethProcess = spawn(this.impl.exec, this.impl.args.split(' '))

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
          console.log(`${this.impl.name} process exited with code ${code}`)
        })
      } else {
        reject(new Error('Failed to start geth process'))
      }
    })
  }

  done (): void {
    if (this.gethProcess != null) {
      this.gethProcess.kill()
    }
  }
}
