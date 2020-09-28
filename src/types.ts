import { Visitor } from 'ast-types'
import {
  CallExpressionKind,
  ExpressionKind,
  SpreadElementKind,
} from 'ast-types/gen/kinds'

export type VisitCallExpression = Visitor['visitCallExpression']
// @ts-ignore
export type AstPath = Parameters<VisitCallExpression>[0]

export type CodeSection<T> = T & { start: number; end: number }
export type CallExpressionWithValueArg = CallExpressionKind & {
  arguments: ((ExpressionKind | SpreadElementKind) & { value: any })[]
}

export type DidFindRequire = (mdl: string, resolved: string) => boolean
