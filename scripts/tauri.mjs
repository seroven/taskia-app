import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const cargoBin = path.join(os.homedir(), '.cargo', 'bin')
const localBin = path.join(root, 'node_modules', '.bin')

process.env.PATH = [cargoBin, localBin, process.env.PATH]
  .filter(Boolean)
  .join(path.delimiter)

const args = process.argv.slice(2)
const tauriBin = path.join(
  localBin,
  process.platform === 'win32' ? 'tauri.cmd' : 'tauri',
)

const child = spawn(tauriBin, args, {
  stdio: 'inherit',
  shell: true,
  env: process.env,
  cwd: root,
})

child.on('exit', (code) => {
  process.exit(code ?? 1)
})
