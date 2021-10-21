import {ethers, Signer} from "ethers";
import {EntryPoint__factory} from "../../typechain";
import http from 'http'
import axios from "axios";

/**
 * For debugging: bring up a local RPC server that exposes the eth_sendUserOperation RPC call.
 * usage:
 * initialize the AASigner with sendUserOpRpc: debugRpcSender()
 */
export function debugRpcUrl(entryPointAddress: string, signer: Signer, port?: number): string {
  const httpServer = debugRpcSender(entryPointAddress, signer, port)
  return `http://localhost:${(httpServer.address() as any).port}`
}

export function debugRpcSender(entryPointAddress: string, signer: Signer, port?: number): http.Server {
  const entryPoint = EntryPoint__factory.connect(entryPointAddress, signer)
  const httpServer = http.createServer((req, resp) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', async () => {
      const req = JSON.parse(body)

      let callResult;
      if (req.method != 'eth_sendUserOperation') {

        //path-through any non-UserOperation calls
        callResult = await (signer.provider as ethers.providers.JsonRpcProvider).send(req.method, req.params)
          .then(res => ({result: res}))
          .catch(err => ({error: {message: err.message}}))
      } else {
        const userOp = req.params[0]
        try {
          const ret = await entryPoint.handleOps([userOp], await signer.getAddress())
          const rcpt = await ret.wait()
          console.log('== gasused=', rcpt.gasUsed)
          callResult = {result: rcpt.transactionHash}
        } catch (e) {
          callResult = {
            error: {
              message: e.message,
              code: -32000,
              data: {
                stack: e.stack,
                name: 'c'
              }
            }
          }
        }
      }
      const jsonResult = {
        id: req.id,
        jsonrpc: req.jsonrpc,
        ...callResult,
      }
      resp.write(JSON.stringify(jsonResult))
      resp.end()
    });
  })
  httpServer.listen(port)
  return httpServer
}
