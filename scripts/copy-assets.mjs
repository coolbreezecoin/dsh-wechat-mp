/** Copy non-TS runtime assets (theme CSS, browser bundle) into the build output. */
import { cpSync, mkdirSync } from 'node:fs'

mkdirSync('lib/themes', { recursive: true })
for (const file of ['base.css', 'default.css', 'grace.css', 'simple.css']) {
  cpSync(`src/themes/${file}`, `lib/themes/${file}`)
}
console.log('copied theme css -> lib/themes')

// The browser half is hand-written in the host's module-loader format, so it is
// copied rather than compiled — tsc would neither type-check nor emit it usefully.
mkdirSync('lib/client', { recursive: true })
cpSync('src/client/index.js', 'lib/client/index.js')
console.log('copied client bundle -> lib/client')
