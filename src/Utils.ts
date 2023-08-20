import { Interface, JsonFragment } from '@ethersproject/abi'

export function getERC165InterfaceID (abi: JsonFragment[]): string {
  let interfaceId =
    abi
      .filter(it => it.type === 'function' && it.name != null)
      .map(it => {
        const iface = new Interface([it])
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return iface.getSighash(it.name!)
      })
      .filter(it => it !== '0x01ffc9a7') // remove the IERC165 method itself
      .map((x) => parseInt(x, 16))
      .reduce((x, y) => x ^ y)
  interfaceId = interfaceId > 0 ? interfaceId : 0xFFFFFFFF + interfaceId + 1
  return '0x' + interfaceId.toString(16).padStart(8, '0')
}
