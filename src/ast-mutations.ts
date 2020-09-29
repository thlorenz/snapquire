import { strict as assert } from 'assert'
import { CallExpressionKind } from 'ast-types/gen/kinds'
import * as recast from 'recast'
import { resolveNonCoreModule, getRelativeModulePath } from './resolve-module'
import { CallExpressionWithValueArg } from './types'
import { NodePath } from 'ast-types/lib/node-path'
const b = recast.types.builders

function isCallExpressionWithValueArg(
  x: CallExpressionKind
): x is CallExpressionWithValueArg {
  return (x as CallExpressionWithValueArg).arguments[0].value != null
}

export function nodeModuleName(node: CallExpressionKind) {
  assert(isCallExpressionWithValueArg(node))
  return node.arguments[0].value
}

/**
 * Normalizes module path for non-core modules
 */
export function normalizeModulePath(
  astPath: NodePath<CallExpressionKind>,
  basedir: string
) {
  const moduleName = nodeModuleName(astPath.node)
  const fullModulePath = resolveNonCoreModule(moduleName, basedir)
  if (fullModulePath != null) {
    const relativeModulePath = getRelativeModulePath(fullModulePath, basedir)
    astPath.get('arguments', 0).replace(b.literal(relativeModulePath))
  }

  return { moduleName, fullModulePath }
}
