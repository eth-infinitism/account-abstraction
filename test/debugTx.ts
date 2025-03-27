import { ethers, providers } from 'ethers'

export interface DebugLog {
  pc: number
  op: string
  gasCost: number
  depth: number
  stack: string[]
  memory: string[]
}

export interface DebugTransactionResult {
  gas: number
  failed: boolean
  returnValue: string
  structLogs: DebugLog[]
}

export async function debugTransaction (txHash: string, disableMemory = true, disableStorage = true): Promise<DebugTransactionResult> {
  const provider = new providers.JsonRpcProvider(process.env.RPC_URL)
  const debugTx = async (hash: string): Promise<DebugTransactionResult> => await provider.send('debug_traceTransaction', [hash, {
    disableMemory,
    disableStorage
  }])

  return await debugTx(txHash)
}
