/** An unsigned JWT whose subject is `userId`, shaped like a Clerk session token. */
export function sessionToken(userId: string): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: userId })}.sig`
}
