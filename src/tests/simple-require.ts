import test from 'tape'
import dedent from 'dedent'
import { Snapquirer } from '../snapquire'
// @ts-ignore
import { highlight } from 'cardinal'

function dumpCode(code: string) {
  console.log('-------------------------')
  console.log(highlight(code))
  console.log('-------------------------')
}

test('single require', (t) => {
  const source = dedent`
      const a = require('a')
      function main () {
        return a
      }
    `
  const snapquirer = new Snapquirer(source)
  const result = snapquirer.transform()

  dumpCode(result)
  t.end()
})

/*
test('single require resolve', (t) => {
  const source = dedent`
      const pathA = require.resolve('a')
      function main () {
        return pathA 
      }
    `
  const snapquirer = new Snapquirer(source)
  const result = snapquirer.transform()

  console.log(result)
  t.end()
})
*/
