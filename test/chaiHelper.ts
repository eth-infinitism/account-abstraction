// remap "eql" function to work nicely with EVM values.

// cleanup "Result" object (returned on web3/ethers calls)
// remove "array" members, convert values to strings.
// so Result obj like
// { '0': "a", '1': 20, first: "a", second: 20 }
// becomes:
// { first: "a", second: "20" }
// map values inside object using mapping func.
import chai from 'chai'

export function objValues (obj: { [key: string]: any }, mapFunc: (val: any, key?: string) => any): any {
  return Object.keys(obj)
    .filter(key => key.match(/^[\d_]/) == null)
    .reduce((set, key) => ({
      ...set,
      [key]: mapFunc(obj[key], key)
    }), {})
}

/**
 * cleanup a value of an object, for easier testing.
 * - Result: this is an array which also contains named members.
 *      - obj.length*2 == Object.keys().length
 *      - remove the array elements, use just the named ones.
 * - recursively handle inner members of object, arrays.
 * - attempt toString. but if no normal value, recurse into fields.
 */
export function cleanValue (val: any): any {
  if (val == null) return val
  if (Array.isArray(val)) {
    if (val.length * 2 === Object.keys(val).length) {
      // "looks" like a Result object.
      return objValues(val, cleanValue)
    }
    // its a plain array. map each array element
    return val.map(val1 => cleanValue(val1))
  }

  const str = val.toString()
  if (str !== '[object Object]') { return str }

  return objValues(val, cleanValue)
}

// use cleanValue for comparing. MUCH easier, since numbers compare well with bignumbers, etc

chai.Assertion.overwriteMethod('eql', (original) => {
  // @ts-ignore
  return function (this: any, expected: any) {
    const _actual = cleanValue(this._obj)
    const _expected = cleanValue(expected)
    // original.apply(this,arguments)
    this._obj = _actual
    original.apply(this, [_expected])
    // assert.deepEqual(_actual, _expected)
    // ctx.assert(
    //     _actual == _expected,
    //     'expected #{act} to equal #{exp}',
    //     'expected #{act} to be different from #{exp}',
    //     _expected,
    //     _actual
    // );
  }
})
