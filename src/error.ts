export class CryptholdError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message)
    this.name = 'CryptholdError'
  }
}
