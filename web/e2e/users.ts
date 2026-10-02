/**
 * The Clerk users the suite signs in as, one per worker, so parallel workers never share a
 * catalog or a sync stream.
 */
export function e2eUserEmails(): string[] {
  const emails = (process.env.E2E_CLERK_USER_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean)
  return [...new Set(emails)]
}
