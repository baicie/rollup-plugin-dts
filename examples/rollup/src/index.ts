export interface User {
  id: number
  name: string
  email: string
  createdAt: Date
}

export interface Config {
  apiUrl: string
  timeout: number
  retries: number
}

export type Status = 'idle' | 'loading' | 'success' | 'error'

export function createUser(data: Omit<User, 'id' | 'createdAt'>): User {
  return {
    id: Date.now(),
    createdAt: new Date(),
    ...data,
  }
}

export function validateConfig(config: Config): boolean {
  return config.apiUrl.length > 0 && config.timeout > 0 && config.retries >= 0
}

export class ApiClient {
  private config: Config
  private status: Status = 'idle'

  constructor(config: Config) {
    this.config = config
  }

  getStatus(): Status {
    return this.status
  }

  async fetch<T>(path: string): Promise<T> {
    this.status = 'loading'
    const url = `${this.config.apiUrl}${path}`
    const response = await fetch(url, {
      signal: AbortSignal.timeout(this.config.timeout),
    })
    this.status = response.ok ? 'success' : 'error'
    return response.json() as Promise<T>
  }
}

export default { createUser, validateConfig, ApiClient }
