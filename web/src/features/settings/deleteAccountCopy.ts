// Free of imports so the end-to-end specs can read the copy without loading the app.

/** The text a musician types to confirm they mean to delete their account. */
export const DELETE_CONFIRMATION_TEXT = 'DELETE'

export const DELETE_ACCOUNT = 'Delete account'
export const DELETE_ACCOUNT_TITLE = 'Delete your account?'
export const DELETE_ACCOUNT_LEAD =
  'This permanently deletes everything in your account, on every device:'
export const SETTINGS_LINE = 'Your settings and instruments'
export const UNSYNCED_LINE = 'Changes that have not synced yet are lost too.'
export const CANNOT_UNDO = 'This cannot be undone.'
export const NO_RECOVERY = ' There is no way to recover your account or anything in it.'
export const CONFIRM_LABEL = `Type ${DELETE_CONFIRMATION_TEXT} to confirm`
export const DELETE_FAILED = 'Your account was not deleted. Nothing was changed. Try again.'
export const DELETE_UNCONFIRMED =
  'The delete could not be confirmed, so your account may already be deleted. Check your connection and try again.'
export const STRIPE_SUBSCRIPTION_LINE =
  'Your Premium subscription is cancelled now, with no refund for the rest of the period.'
export const APPLE_SUBSCRIPTION_LINE =
  'Your App Store subscription keeps billing until you cancel it in App Store settings.'
export const APPLE_CONFIRM_LINE =
  "You'll confirm with Apple so Crosstune is removed from your Apple Account."
