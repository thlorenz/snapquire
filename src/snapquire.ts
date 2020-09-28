import { strict as assert } from 'assert'
import { Visitor } from 'ast-types'
import {
  CallExpressionKind,
  ExpressionKind,
  NodeKind,
  SpreadElementKind,
} from 'ast-types/gen/kinds'
import debug from 'debug'
import path from 'path'
import * as recast from 'recast'
import { resolveNonCoreModule, getRelativeModulePath } from './resolve-module'
import { NODE_CORE_MODULES } from './consts'
import {
  AstPath,
  DidFindRequire,
  VisitCallExpression,
  CodeSection,
} from './types'
import { normalizeModulePath } from './ast-mutations'
const b = recast.types.builders

const logInfo = debug('snapreq:info')

function isStaticRequire(astPath: AstPath) {
  const node = astPath.node
  return (
    // @ts-ignore name does exist on callee
    node.callee.name === 'require' &&
    node.arguments.length === 1 &&
    node.arguments[0].type === 'Literal'
  )
}

function isStaticRequireResolve(astPath: AstPath) {
  const node = astPath.node
  return (
    node.callee.type === 'MemberExpression' &&
    // @ts-ignore name does exist on callee.object
    node.callee.object.name === 'require' &&
    // @ts-ignore name does exist on callee.property
    node.callee.property.name === 'resolve' &&
    node.arguments.length === 1 &&
    node.arguments[0].type === 'Literal'
  )
}

function isTopLevel(astPath: AstPath) {
  if (astPath.scope.isGlobal) return true
  if (astPath.scope.depth !== 1) return false

  let curPath = astPath
  while (curPath) {
    const node = curPath.node
    // TODO: TS assumes that node.type will always be 'CallExpression' in this case
    // @ts-ignore
    if (node.type === 'FunctionExpression') {
      const parentNode = curPath.parent.node

      // Is parent a call with our current node as argument?
      const parentIsCallExpression =
        parentNode.type === 'CallExpression' &&
        parentNode.arguments.indexOf(node) === -1
      if (parentIsCallExpression) return true

      // Is grandparent a call at all?
      const grandparentNode = curPath.parent.parent.node
      const grandparentIsCallExpression =
        grandparentNode.type === 'CallExpression'
      if (grandparentIsCallExpression) return true
    }

    curPath = curPath.parent
  }
  return false
}

export class Snapquirer {
  private readonly _lazyRequiresByVariableName = new Map()
  private readonly _basedir: string
  private readonly _fullFilePath: string
  private readonly _didFindRequire: DidFindRequire

  constructor(
    readonly source: string,
    opts: {
      fullFilePath?: string
      basedir?: string
      didFindRequire?: DidFindRequire
    } = {}
  ) {
    this._didFindRequire = opts.didFindRequire ?? (() => true)

    // TODO: what would be a better default basedir then cwd?
    this._basedir =
      opts.fullFilePath != null
        ? path.dirname(opts.fullFilePath)
        : process.cwd()
    // TODO: do we need fullFilePath and if so is the default sensible?
    this._fullFilePath =
      opts.fullFilePath ?? path.join(this._basedir, '<unknown-file>')
  }

  transform(): string {
    this._lazyRequiresByVariableName.clear()

    // TODO: handle JSON files

    const ast = recast.parse(this.source, {
      parser: {
        parse(source: string) {
          return require('recast/parsers/acorn').parse(source, {
            ecmaVersion: 2020,
            sourceType: 'script',
          })
        },
      },
    })
    this._makeRequiresLazy(ast)
    return recast.print(ast).code
  }

  private _makeRequiresLazy(ast: any) {
    const self = this
    const visitor: { visitCallExpression: VisitCallExpression } = {
      visitCallExpression: function (astPath) {
        if (isStaticRequire(astPath)) {
          const { moduleName, fullModulePath } = normalizeModulePath(
            astPath,
            self._basedir
          )
          logInfo({
            staticRequire: self._stringifyNode(
              astPath.node as CodeSection<CallExpressionKind>
            ),
            moduleName,
          })

          const deferRequire =
            NODE_CORE_MODULES.has(moduleName) ||
            self._didFindRequire(moduleName, fullModulePath ?? moduleName)

          if (deferRequire && isTopLevel(astPath)) {
            self._makeRequireLazy(astPath)
          }
        } else if (isStaticRequireResolve(astPath)) {
          const { moduleName } = normalizeModulePath(astPath, self._basedir)
          logInfo({
            staticRequireResolve: self._stringifyNode(
              astPath.node as CodeSection<CallExpressionKind>
            ),
            moduleName,
          })
        }
        this.traverse(astPath)
      },
    }
    recast.types.visit(ast, visitor)
  }

  private _makeRequireLazy(_astPath: AstPath) {
    logInfo('Making require lazy')
  }

  _stringifyNode(node: NodeKind & { start: number; end: number }): string {
    const s = node.loc!.start
    const code = this.source.slice(node.start, node.end).replace(/\n/g, ' + ')
    return `${code}|(${s.line}:${s.column})`
  }
}
