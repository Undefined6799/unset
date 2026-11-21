// Field limits of our records, the one place code reads them (P1.31). Strings count graphemes unless the name ends in
// Bytes; arrays count items; *MaxSize counts blob bytes. Each value equals the schema's constraint, which
// limits.test.ts proves with one record at the limit and one past it.
export const LIMITS = {
  profile: {
    displayName: 64,
    headline: 200,
    avatarMaxSize: 2_000_000,
    avatarShapeBytes: 32,
    visibilityBytes: 32,
    location: 100,
    websiteBytes: 2000,
  },
  page: {
    cardsMax: 100,
  },
  card: {
    widthBytes: 32,
    surfaceBytes: 32,
    textBytes: 20_000,
    title: 100,
    layoutBytes: 32,
    linksMax: 50,
    linkUriBytes: 2000,
    linkLabel: 100,
    linkDescription: 200,
    entriesMax: 50,
    entryTitle: 120,
    entryTag: 40,
    entryDescription: 300,
    entryUriBytes: 2000,
    buttonsHeading: 120,
    buttonsText: 400,
    buttonsMax: 5,
    emailBytes: 254,
    presetBytes: 32,
    buttonUriBytes: 2000,
    buttonLabel: 40,
    imageMaxSize: 5_000_000,
    imageAlt: 2000,
    imageCaption: 300,
    fitBytes: 32,
    galleryTitle: 100,
    galleryMax: 20,
  },
} as const;

/** Image types the profile's avatar accepts. */
export const IMAGE_ACCEPT = ["image/png", "image/jpeg", "image/webp", "image/avif"] as const;
