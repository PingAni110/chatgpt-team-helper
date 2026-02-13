import jwt from 'jsonwebtoken'
import { getJwtSecret } from '../utils/env-secrets.js'

const JWT_ALGORITHMS = ['HS256']

export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' })
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: JWT_ALGORITHMS })
    req.user = decoded
    next()
  } catch (error) {
    res.status(403).json({ error: 'Invalid token' })
  }
}
