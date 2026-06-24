import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { URL } from 'node:url'

/* global console */

const root = new URL('..', import.meta.url)
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const version = packageJson.version
const releaseDir = new URL('../releases/', import.meta.url)
const zipName = `gewu-chrome-${version}.zip`
const zipPath = join(releaseDir.pathname, zipName)

mkdirSync(releaseDir, { recursive: true })
rmSync(zipPath, { force: true })

execFileSync('npm', ['run', 'build'], {
  cwd: root,
  stdio: 'inherit'
})

execFileSync('zip', ['-r', `../releases/${zipName}`, '.', '-x', '*.DS_Store'], {
  cwd: new URL('../dist/', import.meta.url),
  stdio: 'inherit'
})

const listing = execFileSync('unzip', ['-l', zipPath], {
  cwd: root,
  encoding: 'utf8'
})

if (!listing.includes(' manifest.json')) {
  throw new Error('Chrome package is invalid: manifest.json is not at the zip root.')
}

console.log(`\nChrome package ready: releases/${zipName}`)
