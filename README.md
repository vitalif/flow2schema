# flow2avro

[![Build Status](https://travis-ci.org/loyd/flow2avro.svg?branch=master)](https://travis-ci.org/loyd/flow2avro)

## Example

Input:
```javascript
$ ./bin/flow2avro -
    interface Foo {
        foo: string,
        // $avro long
        bar: number,
        opt: ?number,
        baz: 'one' | 'two',
        mix: 'one' | 'two' | number,
    }
```

Output:
```javascript
[
    type: 'record',
    name: 'Foo',
    namespace: 'example',
    fields: [
        { name: 'foo', type: 'string' },
        { name: 'bar', type: 'long' },
        { name: 'opt', type: [ 'null', 'double' ] },
        { name: 'baz', type: { type: 'enum', symbols: [ 'one', 'two' ] } },
        { name: 'mix', type: [
            'double',
            { type: 'enum', symbols: [ 'one', 'two' ] }
        ] }
    ],
]
```

## TODO

* Generics.
* Errors and warnings.
* Support commonjs modules.
* Documentation.
