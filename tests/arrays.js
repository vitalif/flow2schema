type Type = {
    a: number[],
};

interface Interface {
    a: number[];
}

class Class {
    a: number[];
}

// ###
[
    {
        type: 'record',
        name: 'Type',
        namespace: 'arrays',
        fields: [{
            name: 'a',
            type: {type: 'array', items: 'double'},
        }],
    },
    {
        type: 'record',
        name: 'Interface',
        namespace: 'arrays',
        fields: [{
            name: 'a',
            type: {type: 'array', items: 'double'},
        }],
    },
    {
        type: 'record',
        name: 'Class',
        namespace: 'arrays',
        fields: [{
            name: 'a',
            type: {type: 'array', items: 'double'},
        }],
    },
]
