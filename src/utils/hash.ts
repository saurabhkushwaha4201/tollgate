import bcrypt from 'bcrypt'
import dotenv from 'dotenv'
dotenv.config()
const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS) || 10

export const hashPassword = (password: string): Promise<string> => {
  return bcrypt.hash(password, SALT_ROUNDS)
}

export const comparePassword = (password: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(password, hash)
}