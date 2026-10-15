// Field limits of our records, the one place code reads them (P1.31). Strings count graphemes unless the name ends in
// Bytes; arrays count items; *MaxSize counts blob bytes. Each value equals the schema's constraint, which
// limits.test.ts proves with one record at the limit and one past it.
export const LIMITS = {
  profile: {
    displayName: 64,
    headline: 120,
    bio: 600,
    location: 100,
    websiteBytes: 2000,
    emailBytes: 254,
    availabilityLabel: 140,
    availabilityDetail: 300,
    statsMax: 12,
    statLabel: 40,
    statValue: 40,
    ctaTitle: 120,
    ctaBody: 400,
    ctaLabel: 80,
    ctaHrefBytes: 2000,
    avatarMaxSize: 1_000_000,
    coverMaxSize: 2_000_000,
  },
  section: {
    title: 80,
    summary: 400,
    positionMax: 49,
    itemsMax: 50,
    itemTag: 40,
    itemTitle: 120,
    itemSummary: 400,
    itemUrlBytes: 2000,
    itemHandle: 100,
    itemLabel: 80,
  },
} as const;

/** Image types the profile's avatar and cover accept. */
export const IMAGE_ACCEPT = ["image/png", "image/jpeg", "image/webp"] as const;
