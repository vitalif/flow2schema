import * as assert from 'assert';
import * as fs from 'fs';
import * as pathlib from 'path';

import globals from './globals';
import * as extractors from './extractors';
import Command from './commands';
import Module from './module';
import Scope from './scope';
import CircularList from './list';
import {isNode} from './utils';

export default class Collector {
    constructor(parser, root = '.') {
        this.root = root;
        this.parser = parser;
        this.schemas = [];
        this.tasks = new CircularList;
        this.taskCount = 0;
        this.active = true;
        this.modules = new Map;
        this.roots = new Set;
        this.global = Scope.global(globals);
        this.running = false;
    }

    collect(path, internal = false) {
        // TODO: follow symlinks.
        path = pathlib.resolve(path);

        let module = this.modules.get(path);

        if (module) {
            return;
        }

        // TODO: error wrapping.
        const code = fs.readFileSync(path, 'utf8');
        const ast = this.parser.parse(code);

        // TODO: customize it.
        const namespace = pathToNamespace(pathlib.relative('.', path));

        module = new Module(path, namespace);

        const scope = this.global.extend(module);

        this._freestyle(extractors.declaration, ast.program, scope, null);

        this.modules.set(path, module);

        if (this.running) {
            return;
        }

        try {
            this.running = true;
            this._schedule();

            if (!internal) {
                const task = this._grabExports(module);
                this._spawn(task);
                this._schedule();
            }
        } finally {
            this.running = false;
        }
    }

    // Given the AST output of babylon parse, walk through in a depth-first order.
    _freestyle(group, root, scope, params) {
        let stack;
        let parent;
        let keys = [];
        let index = -1;

        do {
            ++index;

            if (stack && index === keys.length) {
                parent = stack.parent;
                keys = stack.keys;
                index = stack.index;
                stack = stack.prev;

                continue;
            }

            const node = parent ? parent[keys[index]] : root;

            if (isNode(node) && isAcceptableGroup(group, node)) {
                if (!this.roots.has(node)) {
                    const task = this._collect(group, node, scope, params);
                    this.roots.add(node);
                    this._spawn(task);
                }

                continue;
            }

            if (isNode(node) || node instanceof Array) {
                stack = { parent, keys, index, prev: stack };
                parent = node;
                keys = Object.keys(node);
                index = -1;
            }
        } while (stack);
    }

    * _collect(group, node, scope, params) {
        const extractor = group[node.type];

        if (!extractor) {
            this._freestyle(group, node, scope, null);
            return null;
        }

        const iter = extractor(node);

        let result = null;

        while (true) {
            this.active = true;

            const {done, value} = iter.next(result);

            if (done) {
                return value;
            }

            assert.ok(value);

            if (value instanceof Command) {
                switch (value.name) {
                    case 'declare':
                        scope.addDeclaration(...value.data);

                        break;
                    case 'define':
                        const [schema, declared] = value.data;

                        if (declared && params) {
                            const name = schema.name;

                            schema.name = generateGenericName(name, params);

                            scope.addInstance(name, schema, params.map(p => p.value));
                        } else {
                            scope.addDefinition(...value.data);
                        }

                        this.schemas.push(schema);

                        break;
                    case 'external':
                        scope.addImport(value.data);

                        break;
                    case 'provide':
                        scope.addExport(...value.data);

                        break;
                    case 'query':
                        if (params) {
                            const param = params.find(p => p.name === value.data[0]);

                            if (param) {
                                result = param.value;
                                break;
                            }
                        }

                        result = yield* this._query(scope, ...value.data);

                        break;
                    case 'enter':
                        scope = scope.extend();

                        break;
                    case 'exit':
                        assert.ok(scope.parent);
                        scope = scope.parent;

                        break;
                    case 'namespace':
                        result = scope.namespace;

                        break;
                }
            } else if (Array.isArray(value)) {
                result = [];

                for (const val of value) {
                    result.push(yield* this._collect(group, val, scope, params));
                }
            } else {
                assert.ok(isNode(value));
                result = yield* this._collect(group, value, scope, params);
            }
        }
    }

    * _query(scope, name, params) {
        let result = scope.query(name, params);

        // TODO: warning.
        assert.notEqual(result.type, 'unknown');

        // Resulting scope is always the best choice for waiting.
        scope = result.scope;

        // It's only valid the sequence: E*[CT]?F,
        //     where E - external, C - declaration, T - template, F - definition.

        switch (result.type) {
            case 'external':
                const modulePath = scope.resolve(result.info.path);

                this.collect(modulePath, true);

                const module = this.modules.get(modulePath);
                const {imported} = result.info;

                while ((result = module.query(imported, params)).type === 'unknown') {
                    yield;
                }

                if (result.type === 'definition') {
                    return result.schema;
                }

                // TODO: reexports.
                assert.ok(result.type === 'declaration' || result.type === 'template');

                scope = result.scope;
                name = result.name;

                // Fallthrough.
            case 'declaration':
            case 'template':
                let tmplParams = null;

                if (result.type === 'template') {
                    tmplParams = result.params.map((p, i) => ({
                        name: p.name,
                        value: params[i] || p.default,
                    }));
                }

                this._freestyle(extractors.definition, result.node, scope, tmplParams);

                while ((result = scope.query(name, params)).type !== 'definition') {
                    assert.notEqual(result.type, 'external');
                    yield;
                }

                assert.equal(result.type, 'definition');

                // Fallthrough.
            case 'definition':
                return result.schema;
        }
    }

    * _grabExports(module) {
        for (const [scope, name] of module.exports()) {
            yield* this._query(scope, name, null);
        }
    }

    _spawn(task) {
        this.tasks.add(task);
        ++this.taskCount;
    }

    _schedule() {
        const {tasks} = this;

        let marker = null;

        while (!tasks.isEmpty) {
            const task = tasks.remove();

            const {done} = task.next();

            if (done) {
                marker = null;
                continue;
            }

            tasks.add(task);

            if (this.active) {
                marker = task;
                this.active = false;
            } else if (task === marker) {
                // TODO: warning.
                return;
            }
        }
    }
}

function pathToNamespace(path) {
    const pathObj = pathlib.parse(path);

    return pathlib.format({
        dir: pathObj.dir,
        name: pathObj.name,
    })
        // TODO: replace invalid chars.
        .split(pathlib.sep)
        .join('.');
}

function isAcceptableGroup(group, node) {
    return group.entries.includes(node.type);
}

function generateGenericName(base, params) {
    let name = base + '_';

    for (const {value} of params) {
        assert.equal(typeof value, 'string');
        name += '_' + value;
    }

    return name;
}