// Profile (Alex, 2026-10-23): what a member writes on their unset.sh page, checked once at the boundary, and the
// sh.unset.profile record it becomes. Identity keeps sign-in and handles; this module keeps the page.
export {
  EMPTY_PROFILE,
  type ParsedProfile,
  PROFILE_FIELDS,
  type ProfileEdit,
  type ProfileError,
  type ProfileField,
  type ProfileFields,
  type ProfileRecord,
  parseProfileFields,
  readProfileRecord,
  toProfileRecord,
} from "./profile.ts";
