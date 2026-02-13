const INSECURE_DEFAULT_JWT_SECRET = 'your-secret-key-change-this-in-production'

export const getInsecureDefaultJwtSecret = () => INSECURE_DEFAULT_JWT_SECRET

export const getJwtSecret = () => {
  const configured = String(process.env.JWT_SECRET || '').trim()
  return configured || INSECURE_DEFAULT_JWT_SECRET
}

export const getLinuxdoSessionSecret = () => {
  const configured = String(process.env.LINUXDO_SESSION_SECRET || '').trim()
  if (configured) {
    return configured
  }
  return `${getJwtSecret()}::linuxdo`
}
