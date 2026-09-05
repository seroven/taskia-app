import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

dotenv.config({ path: path.join(root, '.env') })

const {
  MYSQL_HOST = 'localhost',
  MYSQL_PORT = '3306',
  MYSQL_USER,
  MYSQL_PASSWORD,
  MYSQL_DATABASE,
} = process.env

const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')

const connection = await mysql.createConnection({
  host: MYSQL_HOST,
  port: Number(MYSQL_PORT),
  user: MYSQL_USER,
  password: MYSQL_PASSWORD,
  multipleStatements: true,
})

await connection.query(sql)

const [tables] = await connection.query(
  `SELECT TABLE_NAME AS name
   FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = ?
   ORDER BY TABLE_NAME`,
  [MYSQL_DATABASE],
)

const [courses] = await connection.query(
  'SELECT id, name FROM courses ORDER BY id',
)

console.log('OK — database:', MYSQL_DATABASE)
console.log('Tables:', tables.map((t) => t.name).join(', '))
console.log('Courses:', courses.length)

await connection.end()
