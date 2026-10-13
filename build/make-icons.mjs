// Genera build/icon.png (512) y build/icon.ico (16–256) a partir de build/icon.svg.
// Uso: node build/make-icons.mjs
import { Resvg } from '@resvg/resvg-js'
import pngToIco from 'png-to-ico'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const svg = readFileSync(join(here, 'icon.svg'), 'utf8')
const render = (size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()

writeFileSync(join(here, 'icon.png'), render(512))
const ico = await pngToIco([16, 24, 32, 48, 64, 128, 256].map(render))
writeFileSync(join(here, 'icon.ico'), ico)
console.log('icon.png e icon.ico generados')
