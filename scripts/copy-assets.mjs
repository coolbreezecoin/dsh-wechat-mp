/** Copy non-TS runtime assets (theme CSS) into the build output. */
import { cpSync, mkdirSync } from 'node:fs'

mkdirSync('lib/themes', { recursive: true })
for (const file of ['base.css', 'default.css', 'grace.css', 'simple.css']) {
  cpSync(`src/themes/${file}`, `lib/themes/${file}`)
}
console.log('copied theme css -> lib/themes')
