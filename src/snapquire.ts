import { Visitor } from 'ast-types'
import * as recast from 'recast'
import debug from 'debug'
import { NodeKind, CallExpressionKind } from 'ast-types/gen/kinds'

const logInfo = debug('snapreq:info')

type VisitCallExpression = Visitor['visitCallExpression']
// @ts-ignore
type AstPath = Parameters<VisitCallExpression>[0]

type CodeSection<T> = T & { start: number; end: number }

function isStaticRequire(astPath: AstPath) {
  const node = astPath.node
  return (
    // @ts-ignore name does exist on callee
    node.callee.name === 'require' &&
    node.arguments.length === 1 &&
    node.arguments[0].type === 'Literal'
  )
}

export class Snapquirer {
  private readonly _lazyRequiresByVariableName = new Map()

  constructor(readonly source: string) {}

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
          logInfo({
            staticRequire: self._stringifyNode(
              astPath.node as CodeSection<CallExpressionKind>
            ),
          })
        }
        this.traverse(astPath)
      },
    }
    recast.types.visit(ast, visitor)
  }

  _stringifyNode(node: NodeKind & { start: number; end: number }): string {
    const s = node.loc!.start
    const code = this.source.slice(node.start, node.end).replace(/\n/g, ' + ')
    return `${code}|(${s.line}:${s.column})`
  }
}
