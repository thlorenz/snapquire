import { Visitor } from 'ast-types'
import { NodePath } from 'ast-types/lib/node-path'
import {
  CallExpressionKind,
  ExpressionKind,
  SpreadElementKind,
  IdentifierKind,
  NewExpressionKind,
} from 'ast-types/gen/kinds'

export type VisitCallExpression = Visitor['visitCallExpression']
export type VisitIdentifier = Visitor['visitIdentifier']

export type AstPath = NodePath<
  CallExpressionKind | IdentifierKind | NewExpressionKind
>

export type CodeSection<T> = T & { start: number; end: number }
export type CallExpressionWithValueArg = CallExpressionKind & {
  arguments: ((ExpressionKind | SpreadElementKind) & { value: any })[]
}

export type DidFindRequire = (mdl: string, resolved: string) => boolean
