import { Router } from 'express'
import { register, login, me, refresh, logout } from './auth.controller'
import { authenticate } from '../../middlewares/authenticate'

const router = Router()

router.post('/register', register)
router.post('/login', login)
router.post('/refresh', refresh)
router.post('/logout', logout)
router.get('/me', authenticate, me)   // protected route

export default router