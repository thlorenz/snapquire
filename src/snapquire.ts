import {
  CallExpressionKind,
  NodeKind,
  IdentifierKind,
} from 'ast-types/gen/kinds'
import { NodePath } from 'ast-types/lib/node-path'

import { strict as assert } from 'assert'
import debug from 'debug'
import path from 'path'
import * as recast from 'recast'
import { NODE_CORE_MODULES, GLOBALS } from './consts'
import {
  AstPath,
  DidFindRequire as ShouldReplaceRequire,
  VisitCallExpression,
  CodeSection,
  VisitIdentifier,
} from './types'
import { normalizeModulePath } from './ast-mutations'

// @ts-ignore no declaration file
import { isReference } from 'ast-util-plus'
const b = recast.types.builders

const logInfo = debug('snapreq:info')
const logTrace = debug('snapreq:trace')

function isStaticRequire(astPath: NodePath<CallExpressionKind>) {
  const node = astPath.node
  return (
    // @ts-ignore name does exist on callee
    node.callee.name === 'require' &&
    node.arguments.length === 1 &&
    node.arguments[0].type === 'Literal'
  )
}

function isStaticRequireResolve(astPath: NodePath<CallExpressionKind>) {
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

function isReferenceToShadowedVariable(astPath: AstPath) {
  // @ts-ignore TODO: better astPath type
  const referenceName = astPath.node.name
  let scope = astPath.scope
  let foundDeclaration = GLOBALS.has(referenceName)
  while (scope) {
    if (scope.declares(referenceName)) {
      if (foundDeclaration) {
        return true
      } else {
        foundDeclaration = true
      }
    }
    scope = scope.parent
  }
  return false
}

export class Snapquirer {
  private readonly _lazyRequiresByVariableName = new Map()
  private readonly _basedir: string
  private readonly _shouldReplaceRequire: ShouldReplaceRequire

  constructor(
    readonly source: string,
    opts: {
      fullFilePath?: string
      basedir?: string
      didFindRequire?: ShouldReplaceRequire
    } = {}
  ) {
    this._shouldReplaceRequire = opts.didFindRequire ?? (() => true)

    // TODO: what would be a better default basedir then cwd?
    this._basedir =
      opts.fullFilePath != null
        ? path.dirname(opts.fullFilePath)
        : process.cwd()
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
    this._deferRequireReferences(ast)
    return recast.print(ast).code
  }

  // aka: replaceDeferredRequiresWithLazyFunctions
  private _makeRequiresLazy(ast: any) {
    const self = this
    {
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
              self._shouldReplaceRequire(
                moduleName,
                fullModulePath ?? moduleName
              )

            if (deferRequire && isTopLevel(astPath)) {
              self._makeAssignOrDeclarationLazy(astPath)
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

    {
      let foundLazyRequireReference: boolean
      const visitor: { visitIdentifier: VisitIdentifier } = {
        visitIdentifier: function (astPath: NodePath<IdentifierKind>) {
          if (isTopLevel(astPath) && self._isReferenceToLazyRequire(astPath)) {
            const nodeName = astPath.node.name
            const lazyRequireIdentifier = self._lazyRequiresByVariableName.get(
              nodeName
            )

            logInfo({
              lazyRequireReference: { nodeName, lazyRequireIdentifier },
            })

            astPath.replace(
              b.callExpression(b.identifier(lazyRequireIdentifier), [])
            )
            self._makeAssignOrDeclarationLazy(astPath)

            foundLazyRequireReference = true
            this.abort()
          } else {
            this.traverse(astPath)
          }
        },
      }
      do {
        foundLazyRequireReference = false
        recast.types.visit(ast, visitor)
      } while (foundLazyRequireReference)
    }
  }

  // aka: replaceReferencesToDeferredRequiresWithFunctionCalls
  private _deferRequireReferences(ast: any) {
    const self = this
    const visitor: { visitIdentifier: VisitIdentifier } = {
      visitIdentifier: function (astPath: NodePath<IdentifierKind>) {
        if (
          !isTopLevel(astPath) &&
          self._isReferenceToLazyRequire(astPath) &&
          !isReferenceToShadowedVariable(astPath)
        ) {
          const nodeName = astPath.node.name
          const lazyRequireIdentifier = self._lazyRequiresByVariableName.get(
            nodeName
          )

          logInfo({
            deferRequireReference: { nodeName, lazyRequireIdentifier },
          })

          astPath.replace(
            b.callExpression(b.identifier(lazyRequireIdentifier), [])
          )
        }
        this.traverse(astPath)
      },
    }
    recast.types.visit(ast, visitor)
  }

  // aka: replaceAssignmentOrDeclarationWithLazyFunction
  private _makeAssignOrDeclarationLazy(astPath: AstPath) {
    let parentPath = astPath.parent
    while (parentPath != null && parentPath.scope === astPath.scope) {
      const parentNode = parentPath.node

      switch (parentNode.type) {
        case 'AssignmentExpression': {
          // TODO
          logTrace({ todoType: parentNode.type })
          throw new Error('Unimplemented')
        }
        case 'VariableDeclarator': {
          const varDecPath = parentPath.parent
          const varDecNode = varDecPath.node

          // Rewrite `const` to `let`
          if (varDecNode.kind === 'const') varDecNode.kind = 'let'

          if (parentNode.id.type === 'ObjectPattern') {
            // TODO
            throw new Error('Unimplemented')
          } else {
            const decName = parentNode.id.name
            assert(decName != null, 'missing `parentNode.id.name`')
            const fnName = `get_${decName}`

            // `function get_x() { return x = x || require('x') }`
            varDecPath.insertAfter(
              b.functionDeclaration(
                b.identifier(fnName),
                [],
                b.blockStatement([
                  b.returnStatement(
                    b.assignmentExpression(
                      '=',
                      parentNode.id,
                      b.logicalExpression('||', parentNode.id, parentNode.init)
                    )
                  ),
                ])
              )
            )
            this._lazyRequiresByVariableName.set(decName, fnName)
          }

          return
        }
        default: {
          logTrace({ ignoredType: parentNode.type })
        }
      }

      parentPath = parentPath.parent
    }
  }

  private _isReferenceToLazyRequire(astPath: NodePath<IdentifierKind>) {
    const scope = astPath.scope
    const lazyRequireFunctionName = this._lazyRequiresByVariableName.get(
      astPath.node.name
    )
    if (
      lazyRequireFunctionName != null &&
      (scope.node.type !== 'FunctionDeclaration' ||
        lazyRequireFunctionName !== astPath.scope.node.id.name) &&
      (scope.node.type !== 'FunctionExpression' ||
        scope.path.parent.node.type !== 'AssignmentExpression' ||
        lazyRequireFunctionName !== scope.path.parent.node.left.name) &&
      (astPath.parent.node.type !== 'Property' ||
        astPath.parent.parent.node.type !== 'ObjectPattern')
    ) {
      if (astPath.parent.node.type === 'AssignmentExpression') {
        // i.e.: `module.exports = a_reference`
        return astPath.name === 'right' && isReference(astPath)
      } else {
        return isReference(astPath)
      }
    }
  }

  private _stringifyNode(
    node: NodeKind & { start: number; end: number }
  ): string {
    const s = node.loc!.start
    const code = this.source.slice(node.start, node.end).replace(/\n/g, ' + ')
    return `${code}|(${s.line}:${s.column})`
  }
}
