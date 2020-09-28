import resolve from 'resolve'
import path from 'path'

export function resolveNonCoreModule(
  moduleName: string,
  basedir: string
): string | null {
  try {
    const fullPath = resolve.sync(moduleName, {
      basedir,
      extensions: ['.js', '.json'],
    })
    const isCoreNodeModule = fullPath.indexOf(path.sep) === -1
    return isCoreNodeModule ? null : fullPath
  } catch (e) {
    return null
  }
}

export function getRelativeModulePath(fullModulePath: string, basedir: string) {
  const relPath = path.relative(basedir, fullModulePath).replace(/\\/g, '/')
  return relPath.startsWith('.') ? relPath : `./${relPath}`
}
