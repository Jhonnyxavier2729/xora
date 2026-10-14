// Publica una versión nueva de Xora para que las apps instaladas se actualicen solas.
//
//   npm run release            → 0.1.0 → 0.1.1 (arreglos)
//   npm run release -- minor   → 0.1.1 → 0.2.0 (novedades)
//   npm run release -- major   → 0.2.0 → 1.0.0
//
// Pasos: comprueba que todo esté guardado en git, sube el número de versión (commit + etiqueta),
// sube los cambios a GitHub, limpia dist/, compila el instalador de Windows y lo publica en
// GitHub Releases junto con latest.yml, que es lo que leen las apps instaladas para enterarse.
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const bump = process.argv[2] ?? 'patch'
if (!['patch', 'minor', 'major'].includes(bump)) {
  console.error(`Tipo de versión desconocido: ${bump} (usa patch, minor o major)`)
  process.exit(1)
}

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts })
const out = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim()

if (out('git status --porcelain')) {
  console.error('Hay cambios sin guardar en git. Haz commit antes de publicar una versión.')
  process.exit(1)
}
if (out('git rev-parse --abbrev-ref HEAD') !== 'master') {
  console.error('Publica desde la rama master.')
  process.exit(1)
}

let token
try {
  token = out('gh auth token')
} catch {
  console.error('Necesitas la CLI de GitHub con sesión iniciada: gh auth login')
  process.exit(1)
}

run('git pull --ff-only origin master')
run(`npm version ${bump} -m "Release v%s"`)
const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
console.log(`\n▶ Publicando Xora ${version}\n`)

// Solo queda el instalador de la versión que se publica.
if (existsSync('dist')) {
  for (const name of readdirSync('dist')) {
    if (/\.(exe|blockmap|yml|yaml)$/i.test(name) || name === 'win-unpacked') rmSync(join('dist', name), { recursive: true, force: true })
  }
}

run('git push origin master --follow-tags')
run('npx electron-vite build')
// Se compila sin publicar y se sube aparte con reintentos: una subida de 140 MB puede cortarse.
run('npx electron-builder --win --x64 --publish never')

const files = [`dist/Xora-Setup-${version}.exe`, `dist/Xora-Setup-${version}.exe.blockmap`, 'dist/latest.yml']
for (const f of files) if (!existsSync(f)) throw new Error(`Falta ${f}: la compilación no lo generó.`)

const notes = `Xora ${version}. Descarga el instalador de Windows y ejecútalo, o espera: las apps ya instaladas se actualizan solas.`
try {
  out(`gh release view v${version}`)
} catch {
  run(`gh release create v${version} --verify-tag --title "Xora ${version}" --notes "${notes}"`)
}
for (let attempt = 1; ; attempt++) {
  try {
    run(`gh release upload v${version} ${files.map((f) => `"${f}"`).join(' ')} --clobber`)
    break
  } catch (err) {
    if (attempt >= 3) throw err
    console.log(`
⚠ La subida falló (intento ${attempt}/3). Reintentando…
`)
  }
}

// Comprueba que lo publicado es exactamente lo compilado (lo que valida el actualizador).
const url = `https://github.com/Jhonnyxavier2729/xora/releases/download/v${version}`
const manifest = await (await fetch(`${url}/latest.yml`, { redirect: 'follow' })).text()
const sha = createHash('sha512').update(readFileSync(files[0])).digest('base64')
if (!manifest.includes(`version: ${version}`) || !manifest.includes(sha)) throw new Error('Lo publicado no coincide con lo compilado.')

console.log(`
✔ Xora ${version} publicada y verificada: https://github.com/Jhonnyxavier2729/xora/releases/tag/v${version}`)
console.log('  Las apps instaladas la verán en unos minutos (al abrirse o cada 4 horas).')
