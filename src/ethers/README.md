# Seamless Ethers support.

This folder contains client support for ethers library.

The AASigner is a wrapper for a Signer, which seamlessly uses Account Abstraction, while keeping the normal ethers.Signer API.

Usage:

```js
const provider = ethers.getDefaultProvider(...)
const signer = new AASigner(provider, {
    entryPointAddress
    
})

console.log('my wallet address=', await signer.getAddress())
//must fund my wallet first, so it can get created and make transactions

const contractViaAA = myContract.connect(signer)

//first call will create wallet. future calls just call it.
await contractViaAA.someMethod()

```
